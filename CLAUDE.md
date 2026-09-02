# CLAUDE.md

Guidance for Claude Code (or any future Claude session) working in this repository.

## What this project is

**Lab Console** — a self-hosted web dashboard for monitoring and controlling a small
fleet (1–10) of Bambu Lab 3D printers over the local network. Built to run on a
Raspberry Pi 3+ (also runs unchanged on Ubuntu/other Linux). No cloud dependency —
everything talks to printers over LAN Developer Mode.

Visual style is a deliberate design constraint, not incidental: a dark navy CRT-panel
aesthetic with cyan vector line art, amber accents, and red/orange reserved *exclusively*
for error states. Think Galaxy's Edge spaceport control panel. See "Design language" below
before touching any UI file.

## FIRST: verify you have the right tree

This project's folder is **`lab-console/`**. An older, incomplete prototype named
`bambu-console/` existed early in development — it lacks demo mode, the docs site, and
`build_manual.py`. If your working directory is named `bambu-console` or uses
`config.example.yaml` instead of `config.example.json`, **stop — you have the wrong copy.**

Check `VERSION` at the repo root (should read 1.3.0), then confirm all 25 files are present:

```bash
cat VERSION
find . -type f -not -path './.git/*' | sort
```

Expected file manifest (25 files):

```
./CLAUDE.md
./README.md
./VERSION
./bambu/cameras.py
./bambu/demo.py
./bambu/discovery.py
./bambu/ftps.py
./bambu/printer.py
./build_manual.py
./config.example.json
./lab-console.service
./mockups/print-complete-celebration.html
./requirements-dev.txt
./requirements.txt
./server.py
./static/app.js
./static/docs/LabConsole-Manual.pdf
./static/docs/admin.html
./static/docs/docs.css
./static/docs/figs.js
./static/docs/index.html
./static/docs/operator.html
./static/docs/reference.html
./static/index.html
./static/style.css
```

Quick behavioral confirmations that you're on 1.3.0:

```bash
grep -n 'DEMO = "--demo"' server.py        # demo mode wired in
grep -n 'add_get("/docs"' server.py        # docs route exists
grep -n 'ARCHIVE' static/index.html        # archive link in status bar
grep -n 'ERROR' static/app.js              # ERROR wording (not "FAULT")
```

If any of these come back empty, re-obtain the current package before doing any work —
do not attempt to "add the missing features," they already exist upstream.

## Repo layout

```
server.py              aiohttp app: routes, WebSocket, camera relay hub, file API
bambu/
  printer.py            BambuPrinter — one MQTT client per real printer, state + commands
  cameras.py             frame generators: chamber_frames() (A1/P1, :6000), rtsp_frames() (X1/H2D, :322, via ffmpeg)
  ftps.py                 implicit-TLS FTPS: list_printable(), upload()
  discovery.py            passive SSDP listener, maps printer serial -> current IP
  demo.py                 DemoPrinter — simulated fleet, mirrors BambuPrinter's public surface
static/
  index.html / app.js / style.css     the console frontend (vanilla JS, no build step)
  docs/                                 in-app "Technical Archive" — 4 pages + shared docs.css/figs.js
build_manual.py         generates static/docs/LabConsole-Manual.pdf (reportlab)
config.example.json     copy to config.json and fill in real printer serials/access codes
lab-console.service     systemd unit for boot-time start
mockups/                standalone HTML mockups from the approval loop below — kept after
                          porting, as the reference for what was agreed
README.md               short quick-start; full docs live in static/docs/ (served at /docs)
```

There is no build step anywhere — frontend is hand-written HTML/CSS/vanilla JS, backend is
plain Python. Keep it that way unless there's a strong reason not to; the whole point is to
stay light enough for a Pi 3.

## Running it

```bash
pip install -r requirements.txt --break-system-packages   # aiohttp, paho-mqtt
# ffmpeg must also be on PATH for X1/H2D camera relay (apt install ffmpeg)
# regenerating the PDF manual additionally needs: pip install -r requirements-dev.txt

python3 server.py --demo          # simulated 3-printer fleet, no config needed — use this for dev
python3 server.py config.json     # real fleet, requires filled-in config.json
```

Open `http://localhost:8080`. `--demo` is the fast path for any frontend work — it fabricates
a printing printer, an idle printer, and one that cycles idle → error → offline on a timer, so
every UI state is reachable without hardware.

Sanity checks worth running after backend changes:
```bash
python3 -m py_compile server.py bambu/*.py
node --check static/app.js static/docs/figs.js   # syntax only, no Node runtime needed beyond this
```
And with the demo server running, a quick WebSocket probe:
```bash
python3 -c "
import asyncio, aiohttp
async def main():
    async with aiohttp.ClientSession() as s, s.ws_connect('http://127.0.0.1:8080/ws') as ws:
        print(await ws.receive_json())
asyncio.run(main())"
```

## Architecture notes

- **One MQTT connection per printer**, TLS on :8883, user `bblp`, password = the printer's
  LAN access code. `BambuPrinter._merge()` deep-merges partial status pushes into a running
  `_report` dict — printers don't always send full state, so don't replace wholesale.
- **State derivation lives in `BambuPrinter.view()`**: `idle | printing | paused | error |
  offline`, derived from `gcode_state`, `hms`, `print_error`, and connectivity. If you add a
  new derived field, add it here and it flows to the frontend automatically via the existing
  WebSocket push.
- **Camera protocols differ by model** and this is load-bearing, not a detail: X1-series/H2D
  use RTSPS on :322 (relayed through `ffmpeg` subprocess → MJPEG), A1/A1 Mini/P1 use a
  proprietary length-prefixed JPEG protocol on :6000. `CamHub` in `server.py` caps concurrent
  relays (`camera.max_streams`, default 1) and evicts the oldest on a new request — don't
  remove this cap, it's what keeps a Pi 3 alive. `server.py` also keeps the newest frame
  per printer (`_preview`, `PREVIEW_TTL` = 30s) and replays it immediately on connect:
  measured time-to-first-frame on a chamber camera is ~3s, against an ~8s panel face
  window, so without it most of a camera turn rendered black. The TTL is the guard that
  keeps a stale image from sitting under the LIVE tag — keep it if you touch this.
- **SSDP discovery is passive** (`bambu/discovery.py`), listens on UDP :2021 and :1990,
  matches printers by serial and updates `BambuPrinter.ip` so DHCP changes don't strand a
  printer. It's additive — `config.json` can also just hardcode an `ip` per printer.
- **DemoPrinter mirrors BambuPrinter's public surface exactly** (`view()`, `pause()`,
  `resume()`, `stop()`, `set_light()`, `start_print()`, `.id`/`.ip`/`.camera_kind`) so
  `server.py` treats real and simulated printers identically. If you add a method to
  `BambuPrinter`, add the matching one to `DemoPrinter` or demo mode will throw on that action.
- **Frontend has no framework and no build step.** `static/app.js` owns: WebSocket
  connect/reconnect, panel face-cycling (status / resting-animation / camera / print-complete,
  ~8s rotation),
  the canvas-drawn vector instruments (radar/orbit/scan), the detail view, and the two modals
  (stop-confirm, start-print). Canvas animation loops self-terminate via `cv.isConnected`
  checks — when adding a new animated face, follow that pattern or it'll leak loops on
  hidden/removed panels.
- **The print-complete face** (`complete()` in `app.js`, ported from
  `mockups/print-complete-celebration.html`) runs 45s on a `printing -> idle` transition where
  the last printing push was >= 90%. The percent gate is what stops a cancelled job
  celebrating, and it reads the *previous* push because `percent` goes null once idle. The face
  sits above camera and resting but below error/offline. Two load-bearing details: its canvas
  timing is anchored to `data-t0`, not to mount, so a remount resumes in place; and
  `renderFleet`'s re-render guard excludes `complete` (as it does `cam`) so the 8s cycle can't
  restart it mid-run. The detail view runs it too, replacing the camera block: `renderDetail`
  only rebuilds on `full`, so `detailCeleb` forces a rebuild when the flourish starts *and*
  when it ends, and because the detail view has no 8s tick the hand-back is an explicit
  `celebTimer` (cleared in `closeDetail`).

## Design language (read before touching CSS/HTML)

Established through several rounds of mockup approval — don't drift from these without a new
mockup round:

- **Color meaning is fixed**: cyan = normal/idle, amber = active/printing, violet = paused,
  mint (`--ok`) = success/completion, **red/orange = error only**. The Galaxy's Edge panels
  the console is modelled on use orange freely; here it is held back for faults, so the
  print-complete sequence leads with mint and amber instead. Don't relax that without a
  decision — it's what makes an error readable from across the room. The camera "LIVE" indicator is deliberately **white**, not red
  — this was a specific fix (see git history / conversation) to stop it reading as an alarm.
- **Error state gets two signals**: the corner lamp blinks red AND the entire panel bezel
  flashes red border + glow, in sync (`@keyframes bezelflash`, `.ppanel.error`). Both, always.
- **State word is "ERROR"**, not "FAULT" — this was an explicit correction from an earlier
  revision, don't reintroduce "FAULT".
- Panels are dark navy CRT bezels with rounded corners, thin cyan vector line art, subtle
  scanline overlay on the whole app (`#app::after`). Resting/idle animations (radar sweep,
  orbit plot, spectrum scan) are ambient only — they carry no data meaning, don't wire real
  values into them.
- The docs site (`static/docs/`) intentionally reuses live component markup/CSS from the
  console (see `.figpanel` in `docs.css`, driven by `figs.js`) rather than static screenshots,
  specifically so documentation can't drift out of sync with the real UI. Keep it that way —
  if you change a panel's look in `style.css`, check whether `docs.css`'s `.figpanel` styles
  need the same change.

## Workflow expectations from the project owner

This project was built through an explicit **mockup-first approval loop**: any visible UI
change (new screen, new state, restyle) gets a standalone HTML mockup for review *before*
being applied to the real `static/` files. Backend-only changes don't need this. If asked to
change how something looks or behaves visually, default to producing a small self-contained
mockup file first rather than editing `static/` directly, unless told otherwise.

Mockups live in `mockups/` and are **kept after porting**, not deleted — they are the record of
what was approved, and they run standalone so a later session can see the intended motion
without reconstructing it from `app.js`. `mockups/print-complete-celebration.html` holds all
three print-complete proposals; option C (INSPECTION) is the one that shipped. The visual
vocabulary there — tapered wedge meters, open-arc reticles, stepped rather than eased motion —
came from the owner's own Galaxy's Edge reference photographs, so prefer it over inventing a
new treatment.

## Documentation surfaces (keep these three in sync)

1. `static/docs/*.html` — in-app "Technical Archive", served at `/docs`, linked from the
   console's status bar (⌘ ARCHIVE).
2. `build_manual.py` — generates `static/docs/LabConsole-Manual.pdf` via reportlab. Content is
   a print-friendly re-derivation of the same four sections (Overview, Operator Guide, Admin
   Guide, Technical Reference), with vector-drawn figures instead of the live canvas ones.
   Regenerate after any docs content change: `python3 build_manual.py`. reportlab is a
   maintainer-only dependency and lives in `requirements-dev.txt`, deliberately kept out
   of `requirements.txt` so deployment hosts don't install it — the PDF ships pre-built.
   Regenerating rewrites the embedded creation date and document ID, so the file always
   shows as changed even when the content is identical; check the diff is real before
   committing it.
3. `README.md` — intentionally short; points into `/docs` rather than duplicating it.

If you change setup steps, config fields, protocols, or API shapes, update **admin.html /
reference.html**, then re-run `build_manual.py`, then check whether `README.md`'s quick-start
still matches.

## Known constraints / don't-break-these

- Target hardware is a Raspberry Pi 3 — avoid adding a JS build pipeline, heavy frontend
  dependencies, or anything that assumes more than one CPU core to spare.
- `camera.max_streams` defaults to 1 for a reason; don't raise the default (per-deployment
  override in `config.json` is fine and documented for beefier hosts).
- No auth/login by design (trusted LAN assumption) — this is documented as a stated security
  tradeoff in the Admin Guide, not an oversight. Don't silently add auth without flagging the
  docs need updating too.
- `sdcard_url_base` in config defaults to `file:///sdcard/`; some newer printer firmware wants
  `file:///mnt/sdcard/` instead — this is a known variable, already documented, not a bug to
  "fix" by changing the default outright.
