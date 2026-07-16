#!/bin/bash
# AS Adventurer Flatpak launcher — starts the local server and opens the Control Panel.
set -euo pipefail

APP_DIR="${FLATPAK_APP_DIR:-/app/share/as-adventurer}"
NODE_BIN="${FLATPAK_NODE_BIN:-/app/bin/node}"
PORT="${PORT:-3000}"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}"
PIDFILE="${XDG_RUNTIME_DIR:-/tmp}/as-adventurer.pid"
# Flatpak sets XDG_STATE_HOME to ~/.var/app/<app-id>/
STATE_HOME="${XDG_STATE_HOME:-${HOME}/.local/state}"
LOGFILE="${STATE_HOME}/as-adventurer/server.log"

mkdir -p "$(dirname "$LOGFILE")"

export PORT
export NODE_ENV=production

is_running() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  # Port already serving our app?
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 1 "$URL/" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

wait_for_server() {
  local i
  for i in $(seq 1 80); do
    if curl -fsS --max-time 1 "$URL/" >/dev/null 2>&1; then
      return 0
    fi
    # Fallback without curl
    if (echo >/dev/tcp/"$HOST"/"$PORT") >/dev/null 2>&1; then
      sleep 0.15
      return 0
    fi
    sleep 0.1
  done
  return 1
}

open_browser() {
  # Prefer host portal / xdg-open so the user's real browser is used
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v gio >/dev/null 2>&1; then
    gio open "$URL" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
}

# Second launch: just open the panel again
if is_running; then
  open_browser
  exit 0
fi

cd "$APP_DIR"

# Run Node server
"$NODE_BIN" "$APP_DIR/server.js" >>"$LOGFILE" 2>&1 &
echo $! >"$PIDFILE"

trap cleanup EXIT INT TERM

if ! wait_for_server; then
  echo "AS Adventurer failed to start. See log: $LOGFILE" >&2
  exit 1
fi

open_browser

# Keep the flatpak process alive while the server runs (needed for some DEs)
# If launched from a .desktop with Terminal=false, this just waits in background.
wait "$(cat "$PIDFILE")" 2>/dev/null || true
