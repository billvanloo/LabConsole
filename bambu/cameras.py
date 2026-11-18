"""Camera frame sources. Both generators yield complete JPEG byte strings.

chamber_frames : A1 / A1 Mini / P1 proprietary protocol, TLS on port 6000, ~1 fps
rtsp_frames    : X1 family / H2D RTSPS on port 322, relayed through ffmpeg as MJPEG
"""
import socket
import ssl
import struct
import logging
import subprocess
import threading
import time

log = logging.getLogger("labconsole.camera")

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


# Whether this host's ffmpeg accepts -tls_verify on an RTSPS input: None until a stream
# tells us. Newer builds (e.g. current Homebrew) need "-tls_verify 0" or they reject the
# printer's self-signed certificate; older builds (Debian/Raspberry Pi OS) don't know the
# option and refuse to start ("Option tls_verify not found") - but they don't verify
# certificates in the first place, so the stream simply runs without it there.
_tls_verify_ok = None


def rtsp_frames(ip: str, access_code: str, stop_flag, fps=8, width=640):
    """Relay the printer's RTSPS stream via ffmpeg, yielding JPEG frames."""
    global _tls_verify_ok
    url = f"rtsps://bblp:{access_code}@{ip}:322/streaming/live/1"
    use_tls_opt = _tls_verify_ok is not False
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-rtsp_transport", "tcp"]
    if use_tls_opt:
        cmd += ["-tls_verify", "0"]
    cmd += ["-i", url, "-an", "-vf", f"fps={fps},scale={width}:-2", "-q:v", "7",
            "-f", "image2pipe", "-vcodec", "mjpeg", "-"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        raise RuntimeError("ffmpeg not found on PATH; it is required for RTSPS cameras")
    # ffmpeg reports why a stream fails (bad code, TLS, refused) only on stderr, so
    # pass it to the console log instead of discarding it. The access code is part
    # of the URL and ffmpeg can echo it, so mask it.
    seen = {"no_tls_opt": False}
    threading.Thread(target=_log_stderr, args=(proc, ip, access_code, seen), daemon=True).start()
    buf = b""
    got_frame = False
    try:
        while not stop_flag():
            chunk = proc.stdout.read(8192)
            if not chunk:
                code = proc.wait()
                time.sleep(0.05)  # let the stderr reader catch up with ffmpeg's last lines
                if use_tls_opt and not got_frame and seen["no_tls_opt"]:
                    _tls_verify_ok = False
                    log.info("[camera %s] this ffmpeg has no -tls_verify option (older builds "
                             "don't verify certificates anyway); retrying without it", ip)
                    break
                if code != 0:
                    log.warning("[camera %s] ffmpeg exited with code %s", ip, code)
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
                if use_tls_opt and not got_frame:
                    _tls_verify_ok = True
                got_frame = True
                yield buf[soi:eoi + 2]
                buf = buf[eoi + 2:]
        else:
            return
    finally:
        proc.kill()
    # only reached on the fallback above: same stream, without the option
    yield from rtsp_frames(ip, access_code, stop_flag, fps, width)


def _log_stderr(proc, ip, access_code, seen):
    for raw in proc.stderr:
        line = raw.decode(errors="replace").rstrip()
        if not line or seen["no_tls_opt"]:
            continue  # after the option error, the rest of that run's output is expected noise
        if "tls_verify" in line and "not found" in line:
            seen["no_tls_opt"] = True
            continue  # expected on older ffmpeg; the relay retries without the option
        log.warning("[camera %s] ffmpeg: %s", ip, line.replace(access_code, "****"))
