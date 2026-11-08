#!/usr/bin/env bash
# ==============================================================================
# deploy/terrarium-update.sh: pull Lineage: Terrarium's updates and apply them
# ==============================================================================
# Run by lineage-terrarium-autoupdate.timer every two minutes (or by hand). When
# origin/main has moved on:
#  1. uv sync, if the Python dependencies changed
#  2. rebuild the kiosk renderer, if renderer/ changed
#  3. restart the simulation server, if sim/, server/ or device/ changed (it saves
#     the world on SIGTERM before it stops)
#  4. restart the kiosk, or reload its page, if the renderer was rebuilt
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_UNIT="${LINEAGE_SERVER_UNIT:-lineage-terrarium-server.service}"
KIOSK_UNIT="${LINEAGE_KIOSK_UNIT:-lineage-terrarium-kiosk.service}"

cd "$REPO_DIR"
git fetch origin main -q

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"
if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  exit 0
fi

echo "[*] New commits on origin/main: $LOCAL_COMMIT -> $REMOTE_COMMIT"
CHANGED_FILES="$(git diff --name-only HEAD origin/main)"
git pull --ff-only origin main

if echo "$CHANGED_FILES" | grep -qE "(uv\.lock|pyproject\.toml)"; then
  echo "[*] Python dependencies changed: uv sync"
  uv sync
fi

RELOAD_KIOSK=0
if echo "$CHANGED_FILES" | grep -qE "^renderer/"; then
  echo "[*] Renderer changed: rebuilding dist-kiosk"
  (cd renderer && npm run build:kiosk)
  RELOAD_KIOSK=1
fi

if echo "$CHANGED_FILES" | grep -qE "^(sim/|server/|device/)"; then
  if systemctl --user is-active --quiet "$SERVER_UNIT" 2>/dev/null; then
    echo "[*] Restarting $SERVER_UNIT (the world is saved first)"
    systemctl --user restart "$SERVER_UNIT"
  fi
fi

if [ "$RELOAD_KIOSK" -eq 1 ]; then
  if systemctl --user is-active --quiet "$KIOSK_UNIT" 2>/dev/null; then
    echo "[*] Restarting $KIOSK_UNIT"
    systemctl --user restart "$KIOSK_UNIT"
  elif command -v xdotool &>/dev/null && DISPLAY=:0 xdotool search --onlyvisible --class chromium windowactivate --sync key F5 2>/dev/null; then
    echo "[*] Chromium page reloaded"
  fi
fi

echo "[ok] Updated to $(git rev-parse --short HEAD)"
