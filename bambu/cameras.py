"""Camera frame sources. Both generators yield complete JPEG byte strings.

chamber_frames : A1 / A1 Mini / P1 proprietary protocol, TLS on port 6000, ~1 fps
rtsp_frames    : X1 family / H2D RTSPS on port 322, relayed through ffmpeg as MJPEG
"""
import socket
import ssl
import struct
import subprocess

JPEG_SOI = b"\xff\xd8\xff"
JPEG_EOI = b"\xff\xd9"


def chamber_frames(ip: str, access_code: str, stop_flag):
    """Yield JPEG frames from the P1/A1 'chamber image' service."""
    auth = bytearray(struct.pack("<IIII", 0x40, 0x3000, 0, 0))
    auth += b"bblp".ljust(32, b"\x00")
    auth += access_code.encode().ljust(32, b"\x00")

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    raw = socket.create_connection((ip, 6000), timeout=10)
    sock = ctx.wrap_socket(raw, server_hostname=ip)
    sock.settimeout(10)
    try:
        sock.sendall(bytes(auth))
        buf = b""
        expected = 0
        while not stop_flag():
            chunk = sock.recv(4096)
            if not chunk:
                return
            buf += chunk
            while True:
                if expected == 0:
                    if len(buf) < 16:
                        break
                    expected = struct.unpack("<I", buf[:4])[0]
                    buf = buf[16:]
                if len(buf) < expected:
                    break
                frame, buf = buf[:expected], buf[expected:]
                expected = 0
                if frame.startswith(JPEG_SOI) and frame.endswith(JPEG_EOI):
                    yield frame
    finally:
        try:
            sock.close()
        except Exception:
            pass


def rtsp_frames(ip: str, access_code: str, stop_flag, fps=8, width=640):
    """Relay the printer's RTSPS stream via ffmpeg, yielding JPEG frames."""
    url = f"rtsps://bblp:{access_code}@{ip}:322/streaming/live/1"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-rtsp_transport", "tcp",
        "-i", url,
        "-an",
        "-vf", f"fps={fps},scale={width}:-2",
        "-q:v", "7",
        "-f", "image2pipe", "-vcodec", "mjpeg", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    buf = b""
    try:
        while not stop_flag():
            chunk = proc.stdout.read(8192)
            if not chunk:
                return
            buf += chunk
            while True:
                soi = buf.find(JPEG_SOI)
                if soi < 0:
                    buf = buf[-2:]
                    break
                eoi = buf.find(JPEG_EOI, soi + 3)
                if eoi < 0:
                    if soi:
                        buf = buf[soi:]
                    break
                yield buf[soi:eoi + 2]
                buf = buf[eoi + 2:]
    finally:
        proc.kill()
