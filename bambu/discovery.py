"""Passive SSDP listener. Bambu printers announce themselves on UDP :2021 and
:1990; the NOTIFY carries USN (serial) and Location (IP). Lets the console
follow printers across DHCP changes without static addresses."""
import logging
import socket
import struct
import threading

log = logging.getLogger("labconsole.discovery")

PORTS = (2021, 1990)
# Printers announce by multicast to this group (Bambu's wiki: 239.255.255.250 on 1990, and
# 2021 by broadcast or multicast depending on model). Linux only delivers a multicast datagram
# if something on the host has joined its group, so a bare bind() hears nothing there. On a
# Mac it can appear to work only because Bambu Studio, running alongside, has joined it.
SSDP_GROUP = "239.255.255.250"


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
