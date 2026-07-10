"""One Bambu Lab printer over LAN Developer Mode MQTT (TLS :8883, user bblp)."""
import json
import ssl
import threading
import time

import paho.mqtt.client as mqtt

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
        self._lock = threading.Lock()
        self._stop = False

    # ------------------------------------------------- connection
    def start(self):
        threading.Thread(target=self._run, name=f"mqtt-{self.id}", daemon=True).start()

    def _run(self):
        while not self._stop:
            if not self.ip:
                time.sleep(3)  # waiting for discovery to supply an IP
                continue
            try:
                self._connect(self.ip)
                return  # paho loop_forever handles reconnects to this IP
            except Exception:
                self._set_online(False)
                time.sleep(5)

    def _connect(self, ip):
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"labconsole-{self.id}", protocol=mqtt.MQTTv311)
        c.username_pw_set("bblp", self.access_code)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # printer uses a self-signed certificate
        c.tls_set_context(ctx)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.reconnect_delay_set(min_delay=2, max_delay=30)
        self._client = c
        c.connect(ip, 8883, keepalive=30)
        c.loop_forever(retry_first_connection=True)

    def set_ip(self, ip):
        """Called by discovery; reconnect if the address moved."""
        if ip and ip != self.ip:
            self.ip = ip
            if self._client:
                try:
                    self._client.disconnect()  # loop_forever will reconnect... to old host
                except Exception:
                    pass
                # simplest reliable path: spawn a fresh connection thread
                try:
                    self._client.loop_stop()
                except Exception:
                    pass
                self._client = None
                threading.Thread(target=self._run, daemon=True).start()

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            client.subscribe(f"device/{self.serial}/report")
            self._set_online(True)
            self.push_all()
        else:
            self._set_online(False)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self._set_online(False)

    def _set_online(self, val):
        if self._online != val:
            self._online = val
            self.on_change(self)

    # ------------------------------------------------- reports
    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload)
        except Exception:
            return
        p = data.get("print")
        if isinstance(p, dict):
            with self._lock:
                self._merge(self._report, p)
            self.on_change(self)

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
        hms = [h for h in (r.get("hms") or []) if isinstance(h, dict)]
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
            "chamber": num("chamber_temper"),
            "fan": r.get("cooling_fan_speed"),
            "speed": r.get("spd_lvl_name") or r.get("spd_lvl"),
            "light": next((l.get("mode") for l in (r.get("lights_report") or [])
                           if l.get("node") == "chamber_light"), None),
            "hms": [{"attr": h.get("attr"), "code": h.get("code")} for h in hms],
            "print_error": err,
        }

    # ------------------------------------------------- commands
    def _publish(self, payload: dict):
        if not self._client:
            raise RuntimeError("printer not connected")
        self._seq += 1
        for section in payload.values():
            section.setdefault("sequence_id", str(self._seq))
        self._client.publish(f"device/{self.serial}/request", json.dumps(payload))

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
