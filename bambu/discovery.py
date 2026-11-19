"""Finding printers on the LAN, and finding them again after a DHCP change.

1. Passive SSDP listener (always on). Printers announce themselves on UDP :2021 and
   :1990; the NOTIFY carries USN (serial) and Location (IP).
2. Active SSDP search. Once a printer has been unreachable for a while, send M-SEARCH
   probes and read the replies instead of waiting for the next announcement.
3. Subnet scan (last resort, on by default). Probe the local /24 for TCP 8883 and
   identify each candidate by the serial in its TLS certificate's common name, or,
   failing that, by an MQTT login with the missing printer's own access code.

Rediscovery is a watchdog thread that runs layers 2-3 for printers that stay offline.
"""
import ipaddress
import logging
import socket
import ssl
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("labconsole.discovery")

PORTS = (2021, 1990)
# Printers announce by multicast to this group (Bambu's wiki: 239.255.255.250 on 1990, and
# 2021 by broadcast or multicast depending on model). Linux only delivers a multicast datagram
# if something on the host has joined its group, so a bare bind() hears nothing there. On a
# Mac it can appear to work only because Bambu Studio, running alongside, has joined it.
SSDP_GROUP = "239.255.255.250"
SEARCH_TARGET = "urn:bambulab-com:device:3dprinter:1"


def _parse(datagram: bytes):
    serial = ip = None
    for line in datagram.decode(errors="ignore").splitlines():
        k, _, v = line.partition(":")
        k = k.strip().lower()
        v = v.strip()
        if k == "usn":
            serial = v
        elif k == "location":
            ip = v.replace("http://", "").split("/")[0].split(":")[0] or v
    return serial, ip


def start(on_found):
    """on_found(serial, ip) is called for every printer announcement seen."""
    for port in PORTS:
        threading.Thread(target=_listen, args=(port, on_found),
                         name=f"ssdp-{port}", daemon=True).start()


def _listen(port, on_found):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except (AttributeError, OSError):
            pass
        s.bind(("", port))
    except OSError as e:
        # port taken (e.g. Bambu Studio running on the same host)
        log.warning("SSDP listener on UDP %d unavailable (%s); printers won't be "
                    "re-found on that port", port, e)
        return
    try:
        mreq = struct.pack("4s4s", socket.inet_aton(SSDP_GROUP), socket.inet_aton("0.0.0.0"))
        s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        joined = "joined " + SSDP_GROUP
    except OSError as e:
        # no multicast route (e.g. no network yet): broadcasts still arrive
        joined = f"could not join {SSDP_GROUP} ({e}); broadcast only"
    log.info("SSDP listener on UDP %d, %s", port, joined)
    while True:
        try:
            data, addr = s.recvfrom(4096)
            serial, ip = _parse(data)
            if serial:
                on_found(serial, ip or addr[0])
        except Exception as e:
            log.debug("SSDP datagram on %d ignored: %s", port, e)
            continue


# ------------------------------------------------------------------ active SSDP search
def ssdp_search(wait_s=3.0):
    """Send M-SEARCH probes and return {serial: ip} for every printer that replies."""
    msg = ("M-SEARCH * HTTP/1.1\r\n"
           f"HOST: {SSDP_GROUP}:1990\r\n"
           'MAN: "ssdp:discover"\r\n'
           "MX: 2\r\n"
           f"ST: {SEARCH_TARGET}\r\n\r\n").encode()
    found = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        s.bind(("", 0))
        for dest in ((SSDP_GROUP, 1990), ("255.255.255.255", 2021), ("255.255.255.255", 1990)):
            try:
                s.sendto(msg, dest)
            except OSError:
                pass
        deadline = time.monotonic() + wait_s
        while (left := deadline - time.monotonic()) > 0:
            s.settimeout(left)
            try:
                data, addr = s.recvfrom(4096)
            except socket.timeout:
                break
            serial, ip = _parse(data)
            if serial:
                found[serial] = ip or addr[0]
    finally:
        s.close()
    return found


# ------------------------------------------------------------------ subnet scan
def local_subnets():
    """The /24 of this host's outbound interface (connect() on UDP sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except OSError:
        return []
    finally:
        s.close()
    if ip.startswith("127."):
        return []
    return [str(ipaddress.ip_network(f"{ip}/24", strict=False))]


def _port_open(ip, port=8883, timeout=0.4):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def cert_common_names(ip, port=8883, timeout=3):
    """Every CN in the host's TLS certificate (subject and issuer). Raw DER scan, so no
    third-party crypto library is needed on the Pi."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((ip, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=ip) as tls:
                der = tls.getpeercert(binary_form=True) or b""
    except (OSError, ssl.SSLError):
        return []
    names, oid, i = [], b"\x06\x03\x55\x04\x03", 0   # OID 2.5.4.3 = commonName
    while (i := der.find(oid, i)) >= 0:
        j = i + len(oid)
        if j + 2 <= len(der) and der[j] in (0x0C, 0x13, 0x16) and der[j + 1] < 0x80:
            names.append(der[j + 2:j + 2 + der[j + 1]].decode(errors="ignore"))
        i = j
    return names


def mqtt_login_ok(ip, access_code, timeout=4):
    """True if an MQTT login with this access code succeeds at ip."""
    import secrets
    import paho.mqtt.client as mqtt
    done, ok = threading.Event(), []
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                    client_id=f"labconsole-probe-{secrets.token_hex(3)}",
                    protocol=mqtt.MQTTv311)
    c.username_pw_set("bblp", access_code)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    c.tls_set_context(ctx)
    c.connect_timeout = timeout

    def on_connect(client, userdata, flags, rc, properties=None):
        ok.append(rc == 0)
        done.set()
    c.on_connect = on_connect
    try:
        c.connect(ip, 8883, keepalive=10)
        c.loop_start()
        done.wait(timeout)
    except Exception:
        return False
    finally:
        try:
            c.disconnect()
            c.loop_stop()
        except Exception:
            pass
    return bool(ok and ok[0])


def probe_address(ip, access_code):
    """Test a typed-in address for one printer: "ok" (that printer is there), "refused"
    (something answers on 8883 but rejects this printer's access code, i.e. a different
    printer or a stale code), or "noanswer"."""
    if not _port_open(ip, timeout=3):
        return "noanswer"
    return "ok" if mqtt_login_ok(ip, access_code) else "refused"


def subnet_scan(wanted, subnets, skip=()):
    """wanted: {serial: access_code}. Returns {serial: (ip, how)} for printers identified."""
    hosts = []
    for net in subnets:
        try:
            hosts += [str(h) for h in ipaddress.ip_network(net, strict=False).hosts()]
        except ValueError:
            log.warning("ignoring bad discovery.scan_subnets entry %r", net)
    hosts = [h for h in hosts if h not in skip]
    with ThreadPoolExecutor(max_workers=32) as pool:
        candidates = [h for h, up in zip(hosts, pool.map(_port_open, hosts)) if up]
    if not candidates:
        return {}
    log.info("scan: MQTT port open on %s", ", ".join(candidates))
    found, unidentified = {}, []
    for ip in candidates:
        names = cert_common_names(ip)
        hit = next((s for s in wanted if s not in found and s in names), None)
        if hit:
            found[hit] = (ip, "certificate")
        else:
            unidentified.append(ip)
    # Certificates didn't name everyone: try each missing printer's own access code.
    # Access codes are per-printer, so a successful login identifies the printer.
    for serial, code in wanted.items():
        if serial in found:
            continue
        for ip in list(unidentified):
            if mqtt_login_ok(ip, code):
                found[serial] = (ip, "access-code login")
                unidentified.remove(ip)
                break
    return found


# ------------------------------------------------------------------ watchdog
class Rediscovery:
    """Watches the fleet and goes looking for printers that stay offline.

    A printer offline for `rediscover_after_s` triggers a pass: SSDP search, then (if
    enabled) a subnet scan for whoever is still missing. Passes are at least
    `min_interval_s` apart; passes that find nothing back off, doubling up to 10 minutes.
    A printer the subnet scan has missed `max_empty_scans` times in a row isn't scanned
    again until it reconnects (SSDP search continues), so a printer that's simply
    switched off for the night doesn't have the network swept every 10 minutes.
    """

    POLL_S = 5

    def __init__(self, printers, on_found, rediscover_after_s=30, subnet_scan=True,
                 scan_subnets=None, min_interval_s=60, max_empty_scans=3,
                 ask_before_search=True, ask_timeout_s=120):
        self.printers = printers            # {id: BambuPrinter}
        self.on_found = on_found            # on_found(serial, ip), same as the listener's
        self.grace = rediscover_after_s
        self.do_scan = subnet_scan
        self.scan_subnets = scan_subnets or []
        self.min_interval_s = min_interval_s
        self.max_empty_scans = max_empty_scans  # 0 = no limit
        self._empty_scans = {}              # printer id -> scans in a row that missed it
        # Before searching, ask a person for the address (panel prompt). If nobody answers
        # within ask_timeout_s (0 = wait forever), search anyway.
        self.ask_before_search = ask_before_search
        self.ask_timeout_s = ask_timeout_s
        for p in printers.values():
            p.ask_timeout_s = ask_timeout_s
        self._interval = min_interval_s
        self._last_pass = -1e9
        threading.Thread(target=self._run, name="rediscovery", daemon=True).start()

    def _run(self):
        while True:
            time.sleep(self.POLL_S)
            for p in self.printers.values():
                if p.online:
                    self._empty_scans.pop(p.id, None)
                elif p.addr_mode == "normal" and p.offline_for() >= self.grace:
                    if self.ask_before_search:
                        p.ask()
                    else:
                        p.choose_auto("discovery.ask_before_search is off")
                elif (p.addr_mode == "ask" and self.ask_timeout_s
                      and p.asking_for() >= self.ask_timeout_s):
                    p.choose_auto(f"nobody answered the prompt in {self.ask_timeout_s:.0f}s")
            lost = [p for p in self.printers.values()
                    if not p.online and p.addr_mode == "auto"]
            if not lost:
                self._interval = self.min_interval_s
                continue
            if time.monotonic() - self._last_pass < self._interval:
                continue
            self._last_pass = time.monotonic()
            try:
                self._pass(lost)
            except Exception:
                log.exception("rediscovery pass failed")

    def _pass(self, lost):
        log.info("rediscovery: %s unreachable; SSDP search",
                 ", ".join(p.id for p in lost))
        missing = {p.serial: p for p in lost}
        for serial, ip in ssdp_search().items():
            p = missing.pop(serial, None)
            if p:
                self._found(p, ip, "SSDP search")
        to_scan = {s: p for s, p in missing.items() if self._may_scan(p)}
        if to_scan and self.do_scan:
            subnets = self.scan_subnets or local_subnets()
            if subnets:
                log.info("rediscovery: scanning %s for %s", ", ".join(subnets),
                         ", ".join(p.id for p in to_scan.values()))
                taken = {p.ip for p in self.printers.values() if p.online and p.ip}
                hits = subnet_scan({s: p.access_code for s, p in to_scan.items()},
                                   subnets, skip=taken)
                for serial, (ip, how) in hits.items():
                    self._found(missing.pop(serial), ip, f"scan, {how}")
                for serial, p in to_scan.items():
                    if serial in missing:
                        n = self._empty_scans[p.id] = self._empty_scans.get(p.id, 0) + 1
                        if self.max_empty_scans and n >= self.max_empty_scans:
                            log.info("rediscovery: %s not found by %d scans in a row; no more "
                                     "scans for it until it reconnects (SSDP search continues)",
                                     p.id, n)
        if len(missing) == len(lost):
            self._interval = min(self._interval * 2, 600)
        else:
            self._interval = self.min_interval_s
        for p in missing.values():
            log.info("rediscovery: %s not found; next try in %ds", p.id, self._interval)
            subnets = self.scan_subnets or local_subnets()
            p.search_info = {
                "next_s": round(self._interval),
                "scans": self._empty_scans.get(p.id, 0),
                "scan_limit": self.max_empty_scans if self.do_scan else 0,
                "scan_stopped": self.do_scan and not self._may_scan(p),
                "subnets": subnets if self.do_scan else [],
            }
            p.on_change(p)

    def _may_scan(self, p):
        return not self.max_empty_scans or self._empty_scans.get(p.id, 0) < self.max_empty_scans

    def _found(self, p, ip, how):
        if ip == p.ip:
            log.info("rediscovery: %s still answers discovery at %s (%s); "
                     "MQTT is refusing or timing out there", p.id, ip, how)
            return
        log.info("rediscovery: %s found at %s (%s)", p.id, ip, how)
        self.on_found(p.serial, ip)
