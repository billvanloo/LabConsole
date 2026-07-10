"""Passive SSDP listener. Bambu printers announce themselves on UDP :2021 and
:1990; the NOTIFY carries USN (serial) and Location (IP). Lets the console
follow printers across DHCP changes without static addresses."""
import socket
import threading

PORTS = (2021, 1990)


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
    except OSError:
        return  # port taken (e.g. Bambu Studio running on the same host)
    while True:
        try:
            data, addr = s.recvfrom(4096)
            serial, ip = _parse(data)
            if serial:
                on_found(serial, ip or addr[0])
        except Exception:
            continue
