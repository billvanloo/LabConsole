# Lab Console

A wall-mountable web dashboard to monitor and control a fleet of Bambu Lab
printers (1-10) over the local network, styled as a spaceport control panel.
Runs on a Raspberry Pi 3 or newer.

## Quick start

```bash
sudo apt update && sudo apt install -y python3-pip ffmpeg
cd lab-console
pip3 install -r requirements.txt --break-system-packages
cp config.example.json config.json   # fill in serials + access codes
python3 server.py                    # open http://<pi>:8080
```

No printers handy? `python3 server.py --demo` runs a full simulated fleet.

## Documentation

Comprehensive documentation lives in the built-in **Technical Archive** -
open **/docs** on the running console (or the ARCHIVE link in the status
bar). It contains:

- **Operator Guide** - reading the dashboard, printer states, cameras, controls
- **Admin Guide** - printer prerequisites, install, full config reference,
  systemd/kiosk setup, troubleshooting
- **Technical Reference** - MQTT topics and commands, camera protocols,
  FTPS, discovery, WebSocket schema, HTTP API

A printable copy is included at `static/docs/LabConsole-Manual.pdf`
(regenerate with `python3 build_manual.py`).

## Printer prerequisites (short version)

Each printer: recent firmware, LAN Only Mode + Developer Mode enabled, note
the Access Code and Serial. X1-series/H2D additionally need LAN Mode
Liveview for cameras. Full details in the Admin Guide.

## Security

No login; access codes live in config.json. Keep the console on a trusted
LAN/VLAN.
