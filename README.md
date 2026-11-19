# Lab Console

A wall-mountable web dashboard to monitor and control a fleet of Bambu Lab
printers (1-10) over the local network, styled as a spaceport control panel.
Runs on a Raspberry Pi 3 or newer.

## Quick start

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3-venv ffmpeg
git clone https://github.com/billvanloo/LabConsole.git ~/lab-console
cd ~/lab-console
python3 -m venv .venv                     # avoids pip's externally-managed-environment error
.venv/bin/pip install -r requirements.txt
cp config.example.json config.json        # fill in serials + access codes
.venv/bin/python server.py                # open http://<pi>:8080
```

No printers handy? `.venv/bin/python server.py --demo` runs a full simulated fleet.

Started from a terminal, the console checks each printer at its `config.json` address and
asks for a new one if a printer doesn't answer (press Enter to let auto-discovery find it
instead). Under systemd there's no prompt; the dashboard panels ask instead.

Rather type a name than an IP? `sudo scripts/set-hostname.sh` names the Pi `labconsole`, so
the console opens at `http://labconsole.local:8080` (same network only).

Start it at boot: `sudo scripts/install-service.sh` installs it as a systemd service, filling in
this folder and your account, and checks the venv, `config.json` and port first.

## Documentation

Comprehensive documentation lives in the built-in **Technical Archive** -
open **/docs** on the running console (or the ARCHIVE link in the status
bar). It contains:

- **Operator Guide** - reading the dashboard, printer states, cameras, controls
- **Admin Guide** - printer prerequisites, install, full config reference,
  systemd/kiosk setup, troubleshooting
- **Technical Reference** - MQTT topics and commands, camera protocols,
  FTPS, discovery, WebSocket schema, HTTP API

A printable copy is included at `static/docs/LabConsole-Manual.pdf`. It ships
pre-built, so a normal install needs nothing extra. To regenerate it after a
docs change:

```bash
.venv/bin/pip install -r requirements-dev.txt   # reportlab
.venv/bin/python build_manual.py
```

## Printer prerequisites (short version)

Each printer: recent firmware; note the Access Code and Serial. X1-series/H2D
additionally need LAN Mode Liveview for cameras.

Printers can stay on Bambu Cloud: status, errors, cameras, the light and file
upload work, but current firmware refuses pause, resume, stop and start print from
the console (use the printer's screen, Bambu Studio or Handy). For full control, use LAN Only Mode + Developer Mode instead, which disconnects the
printer from Bambu Cloud. Either way the console must be able to reach the
printers directly, so Wi-Fi networks with client isolation won't work. Full
details in the Admin Guide.

## When something isn't working

Check `lab-console.log` in the console folder. It records each command with the
printer's reply, plus connection, camera and file errors. Details in the Admin Guide.

## Security

No login; access codes live in config.json. Keep the console on a trusted
LAN/VLAN.
