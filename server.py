#!/usr/bin/env python3
"""Lab Console — Bambu Lab fleet monitor/control for Raspberry Pi.

Run:  python3 server.py [config.json]
Then open http://<pi>:8080
"""
import asyncio
import json
import pathlib
import sys
import threading

from aiohttp import web, WSMsgType

from bambu import discovery
from bambu.printer import BambuPrinter
from bambu import ftps, cameras
from bambu.demo import DemoPrinter, DEMO_FLEET, DEMO_FILES

ROOT = pathlib.Path(__file__).parent
DEMO = "--demo" in sys.argv
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
CONFIG_PATH = pathlib.Path(_args[0] if _args else ROOT / "config.json")

if DEMO:
    CFG = {"http_port": 8080, "camera": {}, "printers": []}
else:
    CFG = json.loads(CONFIG_PATH.read_text())
PRINTERS: dict[str, BambuPrinter] = {}
STATE_VERSION = 0
_version_lock = threading.Lock()


def _bump(_printer=None):
    global STATE_VERSION
    with _version_lock:
        STATE_VERSION += 1


def fleet_view():
    return {"type": "fleet", "version": STATE_VERSION, "demo": DEMO,
            "printers": [p.view() for p in PRINTERS.values()]}


# --------------------------------------------------------------- websocket
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    last = -1

    async def pusher():
        nonlocal last
        while not ws.closed:
            if STATE_VERSION != last:
                last = STATE_VERSION
                try:
                    await ws.send_json(fleet_view())
                except ConnectionResetError:
                    return
            await asyncio.sleep(1.0)

    task = asyncio.create_task(pusher())
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                req = json.loads(msg.data)
                await handle_command(ws, req)
            except Exception as e:
                await ws.send_json({"type": "error", "detail": str(e)})
    finally:
        task.cancel()
    return ws


async def handle_command(ws, req):
    if req.get("type") != "cmd":
        return
    p = PRINTERS.get(req.get("id"))
    if not p:
        raise ValueError("unknown printer")
    action = req.get("action")
    if action == "pause":
        p.pause()
    elif action == "resume":
        p.resume()
    elif action == "stop":
        p.stop()
    elif action == "light":
        p.set_light(bool(req.get("on", True)))
    elif action == "start_print":
        name = req.get("file", "")
        if not name or "/" in name or "\\" in name:
            raise ValueError("bad filename")
        p.start_print(name, CFG.get("sdcard_url_base", "file:///sdcard/"))
    elif action == "refresh":
        p.push_all()
    else:
        raise ValueError("unknown action")
    await ws.send_json({"type": "ack", "id": p.id, "action": action})


# --------------------------------------------------------------- cameras
class CamHub:
    """At most N concurrent relays (default 1). A new request evicts the oldest."""

    def __init__(self, limit):
        self.limit = max(1, limit)
        self.active = []  # list of dicts {flag: [bool]}
        self.lock = threading.Lock()

    def open_slot(self):
        entry = {"stop": False}
        with self.lock:
            self.active.append(entry)
            while len(self.active) > self.limit:
                self.active.pop(0)["stop"] = True
        return entry

    def close(self, entry):
        entry["stop"] = True
        with self.lock:
            if entry in self.active:
                self.active.remove(entry)


HUB = CamHub(int(CFG.get("camera", {}).get("max_streams", 1)))
BOUNDARY = "labconsoleframe"


async def cam_handler(request):
    p = PRINTERS.get(request.match_info["id"])
    if not p or not p.ip or p.camera_kind == "none":
        raise web.HTTPNotFound(text="camera unavailable")

    resp = web.StreamResponse(headers={
        "Content-Type": f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        "Cache-Control": "no-store",
    })
    await resp.prepare(request)

    entry = HUB.open_slot()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    camcfg = CFG.get("camera", {})

    def worker():
        try:
            if p.camera_kind == "chamber":
                gen = cameras.chamber_frames(p.ip, p.access_code,
                                             stop_flag=lambda: entry["stop"])
            else:
                gen = cameras.rtsp_frames(p.ip, p.access_code,
                                          stop_flag=lambda: entry["stop"],
                                          fps=int(camcfg.get("rtsp_fps", 8)),
                                          width=int(camcfg.get("rtsp_width", 640)))
            for frame in gen:
                if entry["stop"]:
                    break
                # drop frames if the client is slow; latest wins
                loop.call_soon_threadsafe(_offer, queue, frame)
        except Exception:
            pass
        finally:
            loop.call_soon_threadsafe(_offer, queue, None)

    threading.Thread(target=worker, name=f"cam-{p.id}", daemon=True).start()
    try:
        while True:
            frame = await queue.get()
            if frame is None or entry["stop"]:
                break
            await resp.write(
                b"--" + BOUNDARY.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                + frame + b"\r\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        HUB.close(entry)
    return resp


def _offer(queue: asyncio.Queue, item):
    if queue.full():
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        pass


# --------------------------------------------------------------- files api
async def files_handler(request):
    p = PRINTERS.get(request.match_info["id"])
    if not p or not p.ip:
        raise web.HTTPNotFound(text="printer offline")
    if DEMO:
        return web.json_response({"files": DEMO_FILES})
    try:
        files = await asyncio.to_thread(ftps.list_printable, p.ip, p.access_code)
        return web.json_response({"files": files})
    except Exception as e:
        raise web.HTTPBadGateway(text=f"FTPS error: {e}")


async def upload_handler(request):
    p = PRINTERS.get(request.match_info["id"])
    if not p or not p.ip:
        raise web.HTTPNotFound(text="printer offline")
    if DEMO:
        reader = await request.multipart()
        field = await reader.next()
        name = pathlib.Path(field.filename or "upload.3mf").name
        while await field.read_chunk(65536):
            pass
        if not any(f["name"] == name for f in DEMO_FILES):
            DEMO_FILES.append({"name": name, "size": 1_000_000})
        return web.json_response({"ok": True, "name": name})
    reader = await request.multipart()
    field = await reader.next()
    name = pathlib.Path(field.filename or "upload.3mf").name
    if not name.lower().endswith((".3mf", ".gcode")):
        raise web.HTTPBadRequest(text="only .3mf / .gcode accepted")
    data = bytearray()
    max_bytes = int(CFG.get("max_upload_mb", 200)) * 1024 * 1024
    while chunk := await field.read_chunk(65536):
        data.extend(chunk)
        if len(data) > max_bytes:
            raise web.HTTPRequestEntityTooLarge(max_size=max_bytes,
                                                actual_size=len(data))
    try:
        await asyncio.to_thread(ftps.upload, p.ip, p.access_code, name, bytes(data))
        return web.json_response({"ok": True, "name": name})
    except Exception as e:
        raise web.HTTPBadGateway(text=f"FTPS error: {e}")


# --------------------------------------------------------------- app
async def index(request):
    return web.FileResponse(ROOT / "static" / "index.html")


def main():
    if DEMO:
        print("*** DEMO MODE — simulated fleet, no printers contacted ***")
        for pc in DEMO_FLEET:
            p = DemoPrinter(pc, on_change=_bump)
            PRINTERS[p.id] = p
            p.start()
    else:
        for pc in CFG["printers"]:
            p = BambuPrinter(pc, on_change=_bump)
            PRINTERS[p.id] = p
            p.start()

        by_serial = {p.serial: p for p in PRINTERS.values()}

        def on_found(serial, ip):
            p = by_serial.get(serial)
            if p:
                p.set_ip(ip)
                _bump()

        discovery.start(on_found)

    @web.middleware
    async def revalidate_static(request, handler):
        # /static has no build step and no content hashes in its URLs, so without
        # an explicit header browsers fall back to heuristic freshness (~10% of
        # file age) and can serve a stale app.js for tens of minutes after an
        # edit. "no-cache" still allows the 304 round-trip, just never a blind hit.
        resp = await handler(request)
        if request.path.startswith("/static/"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    app = web.Application(client_max_size=int(CFG.get("max_upload_mb", 200)) * 1024 * 1024,
                          middlewares=[revalidate_static])
    app.router.add_get("/", index)
    app.router.add_get("/docs", lambda r: web.HTTPFound("/static/docs/index.html"))
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/cam/{id}", cam_handler)
    app.router.add_get("/api/{id}/files", files_handler)
    app.router.add_post("/api/{id}/upload", upload_handler)
    app.router.add_static("/static", ROOT / "static")
    web.run_app(app, port=int(CFG.get("http_port", 8080)))


if __name__ == "__main__":
    main()
