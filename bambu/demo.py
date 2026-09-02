"""Demo mode: a simulated fleet exercising every UI state. No printers needed.

DemoPrinter mirrors BambuPrinter's public surface (view(), pause(), resume(),
stop(), set_light(), start_print(), push_all(), id/name/ip/camera_kind) so
server.py can treat both identically.
"""
import random
import threading
import time

DEMO_FILES = [
    {"name": "calibration_cube.3mf", "size": 2_205_000},
    {"name": "enclosure_lid_r2.3mf", "size": 14_800_000},
    {"name": "cable_clip_x8.3mf", "size": 3_400_000},
    {"name": "nameplate_glyphs.3mf", "size": 1_200_000},
]


class DemoPrinter:
    def __init__(self, cfg, on_change=None):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.model = cfg["model"]
        self.serial = "DEMO-" + self.id.upper()
        self.access_code = "demo"
        self.ip = "127.0.0.1"
        self.camera_kind = "demo"
        self.on_change = on_change or (lambda p: None)
        self.script = cfg.get("script", "idle")

        self._lock = threading.Lock()
        self._state = "idle"
        self._file = ""
        self._percent = 0.0
        self._layer = 0
        self._total_layers = 0
        self._remaining = 0
        self._light = "on"
        self._hms = []
        self._phase_until = 0.0

        if self.script == "printing":
            self._begin_job("sensor_mount_bracket_v3.3mf", start_pct=34)

    def start(self):
        threading.Thread(target=self._run, name=f"demo-{self.id}", daemon=True).start()

    # ------------------------------------------------- simulation loop
    def _run(self):
        while True:
            time.sleep(2)
            with self._lock:
                self._tick()
            self.on_change(self)

    def _tick(self):
        now = time.time()
        if self._state == "printing":
            self._percent = min(100.0, self._percent + random.uniform(0.15, 0.45))
            self._layer = int(self._total_layers * self._percent / 100)
            self._remaining = max(0, int((100 - self._percent) * 1.7))
            if self._percent >= 100:
                self._state = "idle"
        if self.script == "trouble":
            # idle -> error -> offline -> idle, on a timer
            if now >= self._phase_until:
                if self._state == "idle":
                    self._state = "error"
                    self._hms = [{"attr": 0x07008000, "code": 0x00020001}]
                    self._begin_job("filament_test_coupon.3mf", start_pct=37,
                                    keep_state=True)
                    self._phase_until = now + 25
                elif self._state == "error":
                    self._state = "offline"
                    self._hms = []
                    self._phase_until = now + 10
                else:
                    self._state = "idle"
                    self._file = ""
                    self._percent = 0
                    self._phase_until = now + 20

    def _begin_job(self, name, start_pct=0, keep_state=False):
        self._file = name
        self._percent = float(start_pct)
        self._total_layers = random.randint(180, 320)
        self._layer = int(self._total_layers * start_pct / 100)
        self._remaining = int((100 - start_pct) * 1.7)
        if not keep_state:
            self._state = "printing"

    # ------------------------------------------------- BambuPrinter surface
    def set_ip(self, ip):
        pass

    def push_all(self):
        self.on_change(self)

    def pause(self):
        with self._lock:
            if self._state == "printing":
                self._state = "paused"
            elif self._state == "error":
                self._state = "paused"
                self._hms = []
        self.on_change(self)

    def resume(self):
        with self._lock:
            if self._state in ("paused", "error"):
                self._state = "printing"
                self._hms = []
        self.on_change(self)

    def stop(self):
        with self._lock:
            self._state = "idle"
            self._hms = []
            self._file = ""
            self._percent = 0
            self._layer = 0
            self._remaining = 0
        self.on_change(self)

    def set_light(self, on):
        with self._lock:
            self._light = "on" if on else "off"
        self.on_change(self)

    def start_print(self, filename, url_base="file:///sdcard/"):
        with self._lock:
            self._begin_job(filename)
        self.on_change(self)

    def view(self):
        with self._lock:
            s = self._state
            busy = s in ("printing", "paused") or (s == "error" and self._file)
            warm = s in ("printing", "paused")
            return {
                "id": self.id, "name": self.name, "model": self.model,
                "ams": [{"type": "PLA", "color": "#3fd8ff"},
                        {"type": "PLA", "color": "#ffc94d"},
                        {"type": "PETG", "color": "#e8e8e8"},
                        {"type": "", "color": None}],
                "camera": "none" if s == "offline" else "demo",
                "state": s,
                "online": s != "offline",
                "gcode_state": {"printing": "RUNNING", "paused": "PAUSE"}.get(s, "IDLE"),
                "file": self._file,
                "percent": round(self._percent) if busy else None,
                "remaining_min": self._remaining if busy else None,
                "layer": self._layer if busy else None,
                "total_layers": self._total_layers if busy else None,
                "nozzle": 220 if warm else 28, "nozzle_target": 220 if warm else 0,
                "bed": 65 if warm else 27, "bed_target": 65 if warm else 0,
                "chamber": 41 if warm else 29,
                "fan": 100 if warm else 0,
                "speed": "STANDARD",
                "light": self._light,
                "hms": list(self._hms),
                "print_error": 1 if s == "error" else 0,
            }


DEMO_FLEET = [
    {"id": "voyager01", "name": "VOYAGER-01", "model": "X1 CARBON", "script": "printing"},
    {"id": "outpost02", "name": "OUTPOST-02", "model": "H2D", "script": "idle"},
    {"id": "scout03", "name": "SCOUT-03", "model": "A1 MINI", "script": "trouble"},
]
