# Lab Console

A wall-mountable web dashboard to monitor and control a fleet of Bambu Lab
printers (1–10) over the local network. Designed to run on a Raspberry Pi 3
or newer and viewed on a small touch screen or any browser.

- Quick-glance panels per printer: idle / printing (with file name, progress,
  temps, time left) / fault (with HMS codes) / offline
- Panels cycle between status, ambient "scanner" animations, and a rotating
  live camera slot
- Tap a panel for the full console: pinned camera, telemetry, AMS, and
  controls — pause, resume, stop, chamber light, and start a print (from the
  SD card or by uploading a sliced `.3mf`)
- Follows printers across DHCP changes via their SSDP announcements

## Printer prerequisites (each printer)

1. Update to recent firmware.
2. On the printer screen: switch to **LAN Only Mode** and enable
   **Developer Mode** (Settings → General/Network). Developer Mode opens the
   local MQTT, live stream, and FTP channels this tool uses.
3. Note the **Access Code** (Settings → Network) and **Serial Number**
   (Settings → Device).
4. X1-series / H2D: also enable **LAN Mode Liveview** so the RTSPS camera
   stream is available.

## Install on the Pi

```bash
sudo apt update && sudo apt install -y python3-pip ffmpeg   # ffmpeg only needed for X1/H2D cameras
git clone <this folder> /home/pi/lab-console                # or copy the folder over
cd /home/pi/lab-console
pip3 install -r requirements.txt --break-system-packages
cp config.example.json config.json
nano config.json    # fill in serials + access codes (see below)
python3 server.py   # then open http://<pi-address>:8080
```

### config.json

Per printer:

| field | meaning |
|---|---|
| `id` | short unique key, used in URLs |
| `name` | display name on the dashboard |
| `model` | display label (X1 CARBON, H2D, A1 MINI, …) |
| `serial` | printer serial number — used for MQTT topics and discovery |
| `access_code` | LAN access code from the printer screen |
| `ip` | optional; discovery fills it in automatically, but a static/reserved IP makes startup instant |
| `camera` | `rtsp` for X1-series and H2D, `chamber` for A1/A1 Mini/P1-series, `none` to disable |

Global options: `http_port`, `max_upload_mb`,
`camera.max_streams` (concurrent camera relays; keep at 1 on a Pi 3),
`camera.rtsp_fps` / `camera.rtsp_width` (transcode cost knobs), and
`sdcard_url_base` (change to `file:///mnt/sdcard/` if start-print reports a
file-not-found on newer firmware).

## Run at boot

```bash
sudo cp lab-console.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lab-console
```

For a dedicated wall display, point a kiosk browser at
`http://localhost:8080` (e.g. `chromium-browser --kiosk`).

## Notes and troubleshooting

- **Panel says OFFLINE**: printer is unreachable over MQTT. Check power, LAN,
  that Developer Mode is on, and that the access code matches (it changes if
  you regenerate it on the printer).
- **X1/H2D camera shows NO SIGNAL**: confirm LAN Mode Liveview is enabled and
  ffmpeg is installed. On some H2D firmware versions local live streaming was
  temporarily unavailable pending updates; status views still work.
- **A1/P1 camera is ~1 fps**: that is the hardware's chamber-image rate, not
  a bug.
- **Start print fails with file not found**: switch `sdcard_url_base` to
  `file:///mnt/sdcard/`.
- Only files in the SD card root are listed. Uploads go to the root.
- One camera relay runs at a time by default; opening a second view evicts
  the first. Raise `camera.max_streams` on a Pi 4/5 if you want more.
- Security: the console has no login and printer access codes live in
  `config.json`. Keep it on a trusted LAN/VLAN.
