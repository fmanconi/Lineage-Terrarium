#!/usr/bin/env bash
# ==============================================================================
# Lineage: Terrarium — continuous screensaver / kiosk launcher
# ==============================================================================
# Starts the Lineage server headless (daylight from the real sun, solar cycle) and
# opens Chromium full screen in kiosk mode, on any Linux mini-PC with a desktop
# session (Debian, Ubuntu, Raspberry Pi OS). Guide: docs/terrarium-kiosk.md.
#
# Usage:
#   ./deploy/terrarium-kiosk.sh [--data DIR] [--config FILE] [--port N] [--build]
#   ./deploy/terrarium-kiosk.sh --browser-only   # only the kiosk window, for a server
#                                                # already running (systemd unit)
#
# Environment (each overridden by its option):
#   LINEAGE_DATA    island saves            (default: ~/lineage-data)
#   LINEAGE_CONFIG  simulation config       (default: sim/config/terrarium.toml)
#   LINEAGE_PORT    server port             (default: 8080)
#   LINEAGE_BROWSER Chromium binary         (default: first found in PATH)
#
# On exit (Ctrl+C or kill) the server gets SIGTERM and saves the island atomically.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${LINEAGE_DATA:-$HOME/lineage-data}"
CONFIG_FILE="${LINEAGE_CONFIG:-$REPO_DIR/sim/config/terrarium.toml}"
DIST_DIR="$REPO_DIR/renderer/dist-kiosk"
PORT="${LINEAGE_PORT:-8080}"
PROFILE_DIR="$HOME/.lineage-terrarium-kiosk"

DO_BUILD=0
BROWSER_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data)
      DATA_DIR="$2"
      shift 2
      ;;
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --build)
      DO_BUILD=1
      shift
      ;;
    --browser-only)
      BROWSER_ONLY=1
      shift
      ;;
    -h | --help)
      sed -n '2,21p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

URL="http://localhost:${PORT}/?cap=30"
STATUS_URL="http://localhost:${PORT}/status"

server_up() {
  curl -s "$STATUS_URL" >/dev/null 2>&1
}

find_browser() {
  if [ -n "${LINEAGE_BROWSER:-}" ]; then
    echo "$LINEAGE_BROWSER"
    return
  fi
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$candidate" &>/dev/null; then
      command -v "$candidate"
      return
    fi
  done
}

echo "=== Lineage: Terrarium kiosk ==="
echo "Repo:   $REPO_DIR"

BROWSER_BIN="$(find_browser)"
if [ -z "$BROWSER_BIN" ]; then
  echo "[!] No Chromium found in PATH. Install chromium (or set LINEAGE_BROWSER)." >&2
  exit 1
fi
echo "Browser: $BROWSER_BIN"

SERVER_PID=""
if [ "$BROWSER_ONLY" -eq 1 ]; then
  echo -n "[*] Waiting for the server on port ${PORT}..."
  for _ in {1..60}; do
    if server_up; then
      echo " ready."
      break
    fi
    sleep 1
    echo -n "."
  done
  if ! server_up; then
    echo ""
    echo "[!] The server did not answer on ${STATUS_URL}." >&2
    exit 1
  fi
else
  echo "Data:   $DATA_DIR"
  echo "Config: $CONFIG_FILE"

  if [ ! -x "$REPO_DIR/.venv/bin/python" ]; then
    echo "[!] No virtualenv in $REPO_DIR/.venv. Run 'uv sync' first." >&2
    exit 1
  fi
  PYTHON="$REPO_DIR/.venv/bin/python"

  if [ ! -f "$DIST_DIR/index.html" ] || [ "$DO_BUILD" -eq 1 ]; then
    echo "[*] Building the kiosk renderer (dist-kiosk)..."
    if ! command -v npm &>/dev/null; then
      echo "[!] npm not found. Install Node.js 22 to build the renderer." >&2
      exit 1
    fi
    (cd "$REPO_DIR/renderer" && npm ci && npm run build:kiosk)
  fi

  mkdir -p "$DATA_DIR"

  cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
      echo ""
      echo "[*] Stopping the server (it saves the island)..."
      kill -TERM "$SERVER_PID" 2>/dev/null || true
      wait "$SERVER_PID" 2>/dev/null || true
      echo "[✓] Island saved."
    fi
  }
  trap cleanup EXIT INT TERM

  if server_up; then
    echo "[*] A Lineage server is already running on port ${PORT}."
  else
    echo "[*] Starting the Lineage server (headless, solar cycle)..."
    "$PYTHON" -m lineage_server.main \
      --data "$DATA_DIR" \
      --dist "$DIST_DIR" \
      --config "$CONFIG_FILE" \
      --port "$PORT" \
      --solar \
      --headless &
    SERVER_PID=$!

    echo -n "[*] Waiting for the server..."
    for _ in {1..60}; do
      if server_up; then
        echo " ready."
        break
      fi
      sleep 0.5
      echo -n "."
    done
    if ! server_up; then
      echo ""
      echo "[!] The server did not start in time." >&2
      exit 1
    fi
  fi
fi

echo "[*] Opening the kiosk at $URL"
"$BROWSER_BIN" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --disable-background-networking \
  --disable-features=Translate,MediaRouter \
  --password-store=basic \
  --autoplay-policy=no-user-gesture-required \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --user-data-dir="$PROFILE_DIR" \
  "$URL"
