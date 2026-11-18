#!/usr/bin/env bash
# Give the Lab Console host a name the lab can type instead of an IP address, e.g.
# http://labconsole.local:8080. Uses mDNS (Avahi), which Raspberry Pi OS ships and Macs,
# iPhones, Windows 10/11 and most Linux machines resolve on their own. Works on the same
# network as the Pi only.
#
#   sudo scripts/set-hostname.sh              # name it "labconsole"
#   sudo scripts/set-hostname.sh printlab     # or any other name
#   scripts/set-hostname.sh --check [name]    # report only, change nothing
#
# Safe to run again: steps that are already done are skipped.
set -euo pipefail

NAME="labconsole"
CHECK_ONLY=0
HOSTS="${HOSTS_FILE:-/etc/hosts}"   # override only for testing
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) NAME="$arg" ;;
  esac
done
NAME="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"

ok()   { printf '  [ ok ] %s\n' "$*"; }
info() { printf '  [ .. ] %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

# 1. the name itself: a single DNS label, letters/digits/hyphens, no leading/trailing hyphen
if ! [[ "$NAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  fail "'$NAME' isn't a valid host name: use letters, digits and hyphens (max 63), not starting or ending with a hyphen"
fi
[[ "$(uname -s)" == "Linux" ]] || fail "this script sets up the Linux host that runs the console (e.g. the Pi)"
if [[ $CHECK_ONLY -eq 0 && $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi
have() { command -v "$1" >/dev/null 2>&1; }

echo "Lab Console host name: $NAME.local$([[ $CHECK_ONLY -eq 1 ]] && echo '  (check only)')"

# 2. the host name
CURRENT="$(hostname)"
if [[ "$CURRENT" == "$NAME" ]]; then
  ok "host name is already '$NAME'"
elif [[ $CHECK_ONLY -eq 1 ]]; then
  warn "host name is '$CURRENT', not '$NAME'"
else
  info "renaming '$CURRENT' -> '$NAME'"
  if have raspi-config; then
    raspi-config nonint do_hostname "$NAME"   # Raspberry Pi OS: also updates /etc/hosts
  else
    hostnamectl set-hostname "$NAME"
    # keep sudo from complaining "unable to resolve host": point 127.0.1.1 at the new name
    if grep -qE '^127\.0\.1\.1[[:space:]]' "$HOSTS"; then
      sed -i -E "s/^127\.0\.1\.1[[:space:]].*/127.0.1.1\t$NAME/" "$HOSTS"
    else
      printf '127.0.1.1\t%s\n' "$NAME" >> "$HOSTS"
    fi
  fi
  [[ "$(hostname)" == "$NAME" ]] && ok "host name is now '$NAME'" || fail "rename didn't take: hostname still reads '$(hostname)'"
fi

# 3. the mDNS responder that announces it
if have avahi-daemon; then
  ok "avahi-daemon is installed"
elif [[ $CHECK_ONLY -eq 1 ]]; then
  warn "avahi-daemon is not installed (needed to announce $NAME.local)"
else
  have apt-get || fail "avahi-daemon is missing and apt-get isn't available: install it with this system's package manager"
  info "installing avahi-daemon"
  apt-get install -y avahi-daemon >/dev/null
  ok "avahi-daemon installed"
fi
if have systemctl; then
  if [[ $CHECK_ONLY -eq 0 ]]; then
    systemctl enable avahi-daemon >/dev/null 2>&1 || true
    # restart so it announces the new name now, without a reboot
    systemctl restart avahi-daemon
  fi
  if systemctl is-active --quiet avahi-daemon; then ok "avahi-daemon is running"
  else warn "avahi-daemon is not running: try 'sudo systemctl status avahi-daemon'"; fi
  if systemctl is-enabled --quiet avahi-daemon 2>/dev/null; then ok "avahi-daemon starts at boot"
  else warn "avahi-daemon is not set to start at boot"; fi
fi

# 4. does the name actually resolve? (from this machine; other devices on the network see the same answer)
sleep 2
RESOLVED=""
if have avahi-resolve; then
  RESOLVED="$(avahi-resolve -4 -n "$NAME.local" 2>/dev/null | awk '{print $2}' || true)"
elif have getent; then
  RESOLVED="$(getent ahostsv4 "$NAME.local" 2>/dev/null | awk 'NR==1{print $1}' || true)"
fi
if [[ -n "$RESOLVED" ]]; then
  ok "$NAME.local resolves to $RESOLVED"
else
  warn "couldn't confirm $NAME.local from this machine (install avahi-utils for avahi-resolve); try it from another device"
fi

# 5. a firewall can block mDNS (UDP 5353) or the console's port
PORT=8080
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/config.json"
if [[ -f "$CONFIG" ]] && have python3; then
  PORT="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1])).get("http_port", 8080)))' "$CONFIG" 2>/dev/null || echo 8080)"
fi
if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw status | grep -qE '5353/udp.*ALLOW' || warn "ufw is active and doesn't allow 5353/udp: sudo ufw allow 5353/udp"
  ufw status | grep -qE "^$PORT(/tcp)?[[:space:]].*ALLOW" || warn "ufw is active and doesn't allow port $PORT: sudo ufw allow $PORT/tcp"
fi

# 6. is the console listening?
if have ss && ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  ok "the console is listening on port $PORT"
else
  info "nothing is listening on port $PORT yet: start the console (or its service) to use the address below"
fi

echo
echo "Open:  http://$NAME.local:$PORT"
echo "Same network as this host only. If a device can't resolve it, ask IT for a DNS name"
echo "pointing at this host's address$( [[ -n "$RESOLVED" ]] && echo " ($RESOLVED)")."
