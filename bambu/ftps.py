"""Implicit-TLS FTPS access to the printer's SD card (port 990, user bblp)."""
import ftplib
import io
import ssl


class _ImplicitFTPTLS(ftplib.FTP_TLS):
    """ftplib speaks explicit FTPS; Bambu printers use implicit TLS on :990."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._sock = None

    @property
    def sock(self):
        return self._sock

    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value)
        self._sock = value


def _connect(ip: str, access_code: str) -> _ImplicitFTPTLS:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ftp = _ImplicitFTPTLS(context=ctx, timeout=15)
    ftp.connect(ip, 990)
    ftp.login("bblp", access_code)
    ftp.prot_p()
    return ftp


def list_printable(ip: str, access_code: str):
    """Return [{name, size}] for .3mf/.gcode files in the SD card root."""
    ftp = _connect(ip, access_code)
    try:
        out = []
        for name, facts in ftp.mlsd():
            if facts.get("type") == "file" and name.lower().endswith((".3mf", ".gcode")):
                out.append({"name": name, "size": int(facts.get("size", 0))})
        return sorted(out, key=lambda f: f["name"].lower())
    except ftplib.error_perm:
        # some firmware lacks MLSD; fall back to NLST without sizes
        return [{"name": n, "size": 0} for n in ftp.nlst()
                if n.lower().endswith((".3mf", ".gcode"))]
    finally:
        ftp.quit()


def upload(ip: str, access_code: str, filename: str, data: bytes):
    ftp = _connect(ip, access_code)
    try:
        ftp.storbinary(f"STOR {filename}", io.BytesIO(data))
    finally:
        ftp.quit()
