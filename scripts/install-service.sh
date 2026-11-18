#!/usr/bin/env bash
# Install Lab Console as a systemd service, so it starts at boot and restarts itself if it
# crashes. Fills in this checkout's folder and its owner's account in lab-console.service
# (the file assumes user "pi" in /home/pi/lab-console), checks the venv, config.json and
# port first, then starts the service and confirms the console answers.
#
#   sudo scripts/install-service.sh                # install (or update) and (re)start it
#   sudo scripts/install-service.sh --user alice   # run it as another account
#   scripts/install-service.sh --check             # report only, change nothing
#   sudo scripts/install-service.sh --uninstall    # stop it and remove the service
#
# Safe to run again: after a git pull it updates the unit if needed and restarts the console.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NAME="lab-console"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"   # override only for testing
UNIT="$UNIT_DIR/$NAME.service"
TEMPLATE="$REPO/lab-console.service"
VENV_PY="$REPO/.venv/bin/python"
CONFIG="$REPO/config.json"

MODE=install
RUN_USER=""
ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE=check ;;
    --uninstall) MODE=uninstall ;;
    --user) [[ $# -ge 2 ]] || { echo "--user needs an account name" >&2; exit 2; }; RUN_USER="$2"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

ok()   { printf '  [ ok ] %s\n' "$*"; }
info() { printf '  [ .. ] %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ "$(uname -s)" == "Linux" ]] || fail "this script installs a systemd service on the Linux host that runs the console (e.g. the Pi)"
have systemctl && [[ -d /run/systemd/system ]] || fail "systemd isn't running on this machine, so there's no service to install"
if [[ $MODE != check && $EUID -ne 0 ]]; then
  exec sudo "$0" "${ARGS[@]}"
fi

# ------------------------------------------------------------------ uninstall
if [[ $MODE == uninstall ]]; then
  echo "Removing the $NAME service"
  if [[ -f "$UNIT" ]]; then
    systemctl disable --now "$NAME" >/dev/null 2>&1 || true
    rm -f "$UNIT"
    systemctl daemon-reload
    ok "stopped, disabled and removed $UNIT"
  else
    ok "not installed ($UNIT doesn't exist)"
  fi
  echo "The console's files in $REPO are untouched; run it by hand with .venv/bin/python server.py config.json"
  exit 0
fi

echo "Lab Console service: $REPO$([[ $MODE == check ]] && echo '  (check only)')"

# 1. the checkout and the account that runs it
[[ -f "$REPO/server.py" && -f "$TEMPLATE" ]] || fail "$REPO doesn't look like a Lab Console checkout (no server.py / lab-console.service)"
[[ "$REPO" != *[[:space:]]* ]] || fail "the folder path '$REPO' contains a space; move the checkout to a path without spaces"
if [[ -z "$RUN_USER" ]]; then
  RUN_USER="$(stat -c %U "$REPO")"   # whoever cloned it
  [[ "$RUN_USER" != root ]] || fail "$REPO is owned by root; pass the account that should run the console, e.g. --user $(logname 2>/dev/null || echo pi)"
fi
id -u "$RUN_USER" >/dev/null 2>&1 || fail "there's no account named '$RUN_USER'"
as_user() { if [[ $EUID -eq 0 ]]; then runuser -u "$RUN_USER" -- "$@"; else "$@"; fi; }
if [[ $EUID -eq 0 || "$(id -un)" == "$RUN_USER" ]]; then
  as_user test -r "$REPO/server.py" -a -w "$REPO" \
    || fail "'$RUN_USER' can't read and write $REPO (it writes lab-console.log there); fix ownership with: sudo chown -R $RUN_USER $REPO"
fi
ok "runs as '$RUN_USER' from $REPO"

# 2. the virtual environment and its libraries
if [[ ! -x "$VENV_PY" ]]; then
  if [[ $MODE == check ]]; then
    warn "no virtual environment at .venv (install mode creates it)"
  else
    info "creating .venv and installing requirements (a few minutes on a Pi 3)"
    as_user python3 -m venv "$REPO/.venv" || fail "couldn't create .venv: install python3-venv (sudo apt install -y python3-venv) and run this again"
  fi
fi
if [[ -x "$VENV_PY" ]]; then
  if ! as_user "$VENV_PY" -c 'import aiohttp, paho.mqtt' 2>/dev/null; then
    if [[ $MODE == check ]]; then
      warn ".venv is missing aiohttp or paho-mqtt: .venv/bin/pip install -r requirements.txt"
    else
      info "installing requirements into .venv"
      as_user "$VENV_PY" -m pip install -q --disable-pip-version-check -r "$REPO/requirements.txt" || fail "pip install failed; see the error above"
      as_user "$VENV_PY" -c 'import aiohttp, paho.mqtt' || fail ".venv still can't import aiohttp / paho-mqtt"
    fi
  fi
  as_user "$VENV_PY" -c 'import aiohttp, paho.mqtt' 2>/dev/null && ok ".venv has aiohttp and paho-mqtt"
fi
PY="$VENV_PY"; [[ -x "$PY" ]] || PY=python3

# 3. config.json
[[ -f "$CONFIG" ]] || fail "no config.json: cp config.example.json config.json, fill in each printer's serial and access code, then run this again"
CFG_REPORT="$("$PY" - "$CONFIG" <<'EOF'
import json, sys
try:
    c = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"ERR config.json isn't valid JSON: {e}"); sys.exit()
try:
    port = int(c.get("http_port", 8080))
    assert 0 < port < 65536
except Exception:
    print(f"ERR http_port in config.json must be a port number, not {c.get('http_port')!r}"); sys.exit()
ps = c.get("printers") or []
if not isinstance(ps, list) or not ps or not all(isinstance(p, dict) for p in ps):
    print("ERR config.json lists no printers"); sys.exit()
for i, p in enumerate(ps, 1):
    gaps = [k for k in ("id", "serial", "access_code") if not p.get(k)]
    if gaps:
        print(f"ERR printer {i} ({p.get('name', p.get('id', '?'))}) in config.json has no {', '.join(gaps)}"); sys.exit()
placeholder = [str(p.get("id", "?")) for p in ps
               if p.get("access_code") == "12345678" or str(p.get("serial", "")).endswith("000000000")]
if placeholder:
    print("WARN still has example serials/access codes for: " + ", ".join(placeholder))
print(f"PORT {port}")
print(f"OK config.json lists {len(ps)} printer(s): " + ", ".join(str(p.get("name", p.get("id", "?"))) for p in ps))
EOF
)" || fail "couldn't read config.json (see the error above)"
PORT=8080
while IFS= read -r line; do
  case "$line" in
    ERR*)  fail "${line#ERR }" ;;
    WARN*) warn "${line#WARN }" ;;
    OK*)   ok "${line#OK }" ;;
    PORT*) PORT="${line#PORT }" ;;
  esac
done <<< "$CFG_REPORT"

# 4. ffmpeg, for X1 / H2D cameras
have ffmpeg && ok "ffmpeg is installed" || warn "ffmpeg isn't installed: X1/H2D cameras won't show (sudo apt install -y ffmpeg)"

# 5. the port: a console started by hand would keep the service from binding it
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }
ACTIVE=0; systemctl is-active --quiet "$NAME" 2>/dev/null && ACTIVE=1
if [[ $ACTIVE -eq 0 ]] && listening; then
  WHO=""; have ss && WHO="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'users:(.*)' | head -1 || true)"
  MSG="something is already listening on port $PORT ${WHO:+($WHO) }- usually the console started by hand in a terminal; stop it (Ctrl+C) and run this again"
  [[ $MODE == check ]] && warn "$MSG" || fail "$MSG"
else
  ok "port $PORT is free for the service$([[ $ACTIVE -eq 1 ]] && echo ' (the service holds it now)')"
fi

# 6. the unit: lab-console.service with this checkout's path and account filled in
WANT="$(sed -e "s|^User=.*|User=$RUN_USER|" -e "s|/home/pi/lab-console|$REPO|g" "$TEMPLATE")"
CHANGED=0
if [[ -f "$UNIT" ]] && [[ "$(cat "$UNIT")" == "$WANT" ]]; then
  ok "$UNIT is installed and up to date"
elif [[ $MODE == check ]]; then
  [[ -f "$UNIT" ]] && warn "$UNIT differs from what this checkout would install (install mode updates it)" \
                   || warn "the service isn't installed yet"
else
  printf '%s\n' "$WANT" > "$UNIT"
  systemctl daemon-reload
  CHANGED=1
  ok "wrote $UNIT"
fi

if [[ $MODE == check ]]; then
  if [[ -f "$UNIT" ]]; then
    systemctl is-enabled --quiet "$NAME" 2>/dev/null && ok "starts at boot" || warn "not set to start at boot"
    [[ $ACTIVE -eq 1 ]] && ok "running" || warn "not running"
  fi
  exit 0
fi

# 7. enable and (re)start, so a re-run after git pull picks up the new code
systemctl enable "$NAME" >/dev/null 2>&1
ok "starts at boot"
info "$([[ $ACTIVE -eq 1 ]] && echo restarting || echo starting) the console"
systemctl restart "$NAME"

# 8. does it answer?
UP=0
for _ in $(seq 1 20); do
  sleep 1
  if "$PY" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/', timeout=2)" 2>/dev/null; then UP=1; break; fi
done
if [[ $UP -eq 0 ]]; then
  warn "the console didn't answer on port $PORT within 20 s; last log lines:"
  journalctl -u "$NAME" -n 20 --no-pager 2>/dev/null || true
  fail "check the lines above (a typo in config.json is the usual cause), fix it and run this again"
fi
ok "the console answers on port $PORT"

echo
echo "Open:    http://$(hostname).local:$PORT   (or this machine's IP address)"
echo "Logs:    journalctl -u $NAME -f      (also $REPO/lab-console.log)"
echo "Update:  git pull, then sudo systemctl restart $NAME (or run this script again)"
