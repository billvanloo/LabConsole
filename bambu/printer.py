"""One Bambu Lab printer over LAN Developer Mode MQTT (TLS :8883, user bblp)."""
import json
import logging
import secrets
import ssl
import threading
import time

import paho.mqtt.client as mqtt

log = logging.getLogger("labconsole.printer")

# A printer normally answers a command within a second or two. Silence past this is
# worth a log line: on cloud-connected firmware a refused command is often just dropped.
REPLY_TIMEOUT = 10.0

# HMS level is the third group of the code (the high 16 bits of "code"): 0001 error,
# 0002 warning (pauses the print), 0003 info, 0000 invalid. Info entries are routine
# ("first layer inspection in progress"), so they must never raise the ERROR state.
_HMS_INFO_LEVELS = {0, 3}


def _hms_level(h):
    try:
        return int(h.get("code") or 0) >> 16
    except (TypeError, ValueError):
        return 1  # unreadable: err on the side of showing it


# gcode_state -> dashboard state
_RUNNING = {"RUNNING", "PREPARE", "SLICING"}
_PAUSED = {"PAUSE"}


class BambuPrinter:
    def __init__(self, cfg: dict, on_change=None):
        self.id = cfg["id"]
        self.name = cfg.get("name", cfg["id"])
        self.model = cfg.get("model", "?")
        self.serial = cfg["serial"]
        self.access_code = str(cfg["access_code"])
        self.ip = cfg.get("ip")  # may be filled/updated by discovery
        self.camera_kind = cfg.get("camera", "rtsp")  # rtsp | chamber | none
        self.on_change = on_change or (lambda p: None)

        self._report = {}          # merged "print" payload
        self._online = False
        self._seq = 0
        self._client = None
        # Unique per console process. A broker drops the older connection when a client
        # id is reused, so a fixed id let two consoles (or two clients in one console)
        # knock each other off every few seconds.
        self._client_id = f"labconsole-{self.id}-{secrets.token_hex(3)}"
        self._lock = threading.Lock()
        self._stop = False
        self._pending = {}          # sequence_id -> command name, awaiting a reply
        self._last_problem = None   # dedupes repeated connect failures in the log
        # When the printer last went offline (monotonic), or None while online. Starts set:
        # a printer is offline until its first connect. Read by discovery.Rediscovery.
        self._offline_since = time.monotonic()

    # ------------------------------------------------- connection
    def start(self):
        threading.Thread(target=self._run, name=f"mqtt-{self.id}", daemon=True).start()

    def _run(self):
        """The only place a client is created, so a printer never has two connections.

        Each pass connects to the current address and lets paho handle reconnects there.
        loop_forever returns when set_ip() disconnects the client, and the next pass
        picks up the new address.
        """
        while not self._stop:
            ip = self.ip
            if not ip:
                time.sleep(3)  # waiting for discovery to supply an IP
                continue
            c = self._make_client()
            self._client = c
            try:
                c.connect(ip, 8883, keepalive=30)
                c.loop_forever(retry_first_connection=True)
            except Exception as e:
                self._problem(f"cannot connect to {ip}:8883: {e}")
            finally:
                self._client = None
                self._close(c)
                self._set_online(False)
            if self.ip == ip:
                time.sleep(5)  # failed or dropped at this address: back off
            # else: the address changed, reconnect to the new one straight away

    def _make_client(self):
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=self._client_id, protocol=mqtt.MQTTv311)
        c.username_pw_set("bblp", self.access_code)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # printer uses a self-signed certificate
        c.tls_set_context(ctx)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.reconnect_delay_set(min_delay=2, max_delay=30)
        return c

    @staticmethod
    def _close(c):
        try:
            c.disconnect()
        except Exception:
            pass
        try:
            sock = c.socket()
            if sock:
                sock.close()
        except Exception:
            pass

    @property
    def online(self):
        return self._online

    def offline_for(self):
        """Seconds since the printer went offline (0 while online)."""
        since = self._offline_since
        return 0.0 if since is None else time.monotonic() - since

    def set_ip(self, ip):
        """Called by discovery. Only moves the address; _run() does the reconnecting."""
        if ip and ip != self.ip:
            log.info("%s: address changed %s -> %s (discovery)", self.id, self.ip, ip)
            self.ip = ip
            if not self._online:
                self._offline_since = time.monotonic()  # fresh grace period at the new address
            c = self._client
            if c:
                try:
                    c.disconnect()  # ends loop_forever; _run() reconnects to the new ip
                except Exception:
                    pass

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if client is not self._client:
            return  # a client being retired; never let it act for this printer
        if reason_code == 0:
            log.info("%s: MQTT connected to %s", self.id, self.ip)
            self._last_problem = None
            client.subscribe(f"device/{self.serial}/report")
            self._set_online(True)
            try:
                self.push_all()
            except Exception as e:  # never let a failed refresh kill the connection loop
                log.warning("%s: initial status request failed: %s", self.id, e)
        else:
            # "Not authorized" / "Bad user name or password" = wrong access code
            self._problem(f"MQTT login refused by {self.ip}: {reason_code}")
            self._set_online(False)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        if client is not self._client:
            return
        if self._online:
            log.warning("%s: MQTT disconnected from %s: %s", self.id, self.ip, reason_code)
        self._set_online(False)

    def _problem(self, text):
        """Log a connection problem once, not on every retry."""
        if text != self._last_problem:
            self._last_problem = text
            log.warning("%s: %s", self.id, text)

    def _set_online(self, val):
        if self._online != val:
            self._online = val
            self._offline_since = None if val else time.monotonic()
            self.on_change(self)

    # ------------------------------------------------- reports
    def _on_message(self, client, userdata, msg):
        if client is not self._client:
            return
        try:
            data = json.loads(msg.payload)
        except Exception as e:
            log.debug("%s: unreadable report (%s): %r", self.id, e, msg.payload[:200])
            return
        if isinstance(data, dict):
            self._log_replies(data)
        else:
            return
        p = data.get("print")
        if isinstance(p, dict):
            with self._lock:
                self._merge(self._report, p)
            self.on_change(self)

    def _log_replies(self, data):
        """Log the printer's answers to commands; routine status pushes are skipped."""
        for section, body in data.items():
            if not isinstance(body, dict):
                continue
            cmd = body.get("command")
            if not cmd or cmd == "push_status":
                continue
            seq = str(body.get("sequence_id", ""))
            ours = self._pending.pop(seq, None)
            if not ours:
                # replies to Bambu Studio/Handy or unsolicited messages
                log.debug("%s: %s/%s message: %s", self.id, section, cmd, body)
                continue
            result = str(body.get("result", "")).lower()
            detail = {k: body[k] for k in ("result", "reason", "err_code", "errno")
                      if k in body}
            if result in ("", "success", "ok"):
                log.info("%s: printer accepted %s (seq %s) %s", self.id, cmd, seq, detail)
            else:
                log.warning("%s: printer REJECTED %s (seq %s): %s", self.id, cmd, seq, detail)

    def _check_reply(self, seq):
        cmd = self._pending.pop(seq, None)
        if cmd:
            log.warning("%s: no reply to %s (seq %s) after %.0fs; the printer may have "
                        "ignored it (cloud-mode firmware can drop third-party commands)",
                        self.id, cmd, seq, REPLY_TIMEOUT)

    @staticmethod
    def _merge(dst, src):
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                BambuPrinter._merge(dst[k], v)
            else:
                dst[k] = v

    # ------------------------------------------------- derived view
    def view(self) -> dict:
        with self._lock:
            r = dict(self._report)
        gs = r.get("gcode_state", "")
        entries = [h for h in (r.get("hms") or []) if isinstance(h, dict)]
        hms = [h for h in entries if _hms_level(h) not in _HMS_INFO_LEVELS]
        notices = [h for h in entries if _hms_level(h) == 3]
        err = int(r.get("print_error") or 0)
        if not self._online:
            state = "offline"
        elif err or hms:
            state = "error"
        elif gs in _RUNNING:
            state = "printing"
        elif gs in _PAUSED:
            state = "paused"
        else:
            state = "idle"

        def num(key):
            try:
                return round(float(r.get(key)))
            except (TypeError, ValueError):
                return None

        # Newer firmware can report chamber temperature only under device.ctc
        # (the chamber temperature control module), not as chamber_temper. On
        # H2-series the value packs the target into the high 16 bits.
        chamber = num("chamber_temper")
        if chamber is None:
            try:
                chamber = int(r["device"]["ctc"]["info"]["temp"]) & 0xFFFF
            except (KeyError, TypeError, ValueError):
                pass

        ams_trays = []
        for unit in ((r.get("ams") or {}).get("ams") or []):
            for tray in (unit.get("tray") or []):
                ams_trays.append({
                    "type": tray.get("tray_type") or "",
                    "color": ("#" + tray.get("tray_color", "")[:6]) if tray.get("tray_color") else None,
                })
        return {
            "id": self.id, "name": self.name, "model": self.model,
            "ams": ams_trays,
            "camera": self.camera_kind if self.ip else "none",
            "state": state,
            "online": self._online,
            "gcode_state": gs,
            "file": r.get("subtask_name") or r.get("gcode_file") or "",
            "percent": num("mc_percent"),
            "remaining_min": num("mc_remaining_time"),
            "layer": r.get("layer_num"),
            "total_layers": r.get("total_layer_num"),
            "nozzle": num("nozzle_temper"), "nozzle_target": num("nozzle_target_temper"),
            "bed": num("bed_temper"), "bed_target": num("bed_target_temper"),
            "chamber": chamber,
            "fan": r.get("cooling_fan_speed"),
            "speed": r.get("spd_lvl_name") or r.get("spd_lvl"),
            "light": next((l.get("mode") for l in (r.get("lights_report") or [])
                           if l.get("node") == "chamber_light"), None),
            "hms": [{"attr": h.get("attr"), "code": h.get("code")} for h in hms],
            "notices": [{"attr": h.get("attr"), "code": h.get("code")} for h in notices],
            "print_error": err,
        }

    # ------------------------------------------------- commands
    def _publish(self, payload: dict):
        if not self._client:
            raise RuntimeError("printer not connected")
        self._seq += 1
        seq = str(self._seq)
        names = []
        for section in payload.values():
            section.setdefault("sequence_id", seq)
            names.append(section.get("command", "?"))
        name = "/".join(names)
        info = self._client.publish(f"device/{self.serial}/request", json.dumps(payload))
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            log.error("%s: could not send %s (seq %s): %s", self.id, name, seq,
                      mqtt.error_string(info.rc))
            raise RuntimeError(f"send failed: {mqtt.error_string(info.rc)}")
        if name == "pushall":
            log.debug("%s: sent pushall (seq %s)", self.id, seq)
            return
        log.info("%s: sent %s (seq %s)", self.id, name, seq)
        self._pending[seq] = name
        t = threading.Timer(REPLY_TIMEOUT, self._check_reply, args=(seq,))
        t.daemon = True
        t.start()

    def push_all(self):
        self._publish({"pushing": {"command": "pushall"}})

    def pause(self):
        self._publish({"print": {"command": "pause", "param": ""}})

    def resume(self):
        self._publish({"print": {"command": "resume", "param": ""}})

    def stop(self):
        self._publish({"print": {"command": "stop", "param": ""}})

    def set_light(self, on: bool):
        self._publish({"system": {
            "command": "ledctrl", "led_node": "chamber_light",
            "led_mode": "on" if on else "off",
            "led_on_time": 500, "led_off_time": 500,
            "loop_times": 0, "interval_time": 0,
        }})

    def start_print(self, filename: str, url_base: str = "file:///sdcard/"):
        """Print a .3mf already on the SD card (uploaded via FTPS or left there)."""
        self._publish({"print": {
            "command": "project_file",
            "param": "Metadata/plate_1.gcode",
            "url": url_base + filename,
            "subtask_name": filename,
            "use_ams": True,
            "timelapse": False,
            "bed_leveling": True,
            "flow_cali": False,
            "vibration_cali": False,
            "layer_inspect": False,
            "bed_type": "auto",
        }})
