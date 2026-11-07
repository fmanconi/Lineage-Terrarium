#!/usr/bin/env bash
# ==============================================================================
# Lineage-Smerdino: Continuous Screensaver / Biological Kiosk Launcher
# ==============================================================================
# Questo script avvia il server di Lineage in background (con Solar Cycle attivo)
# e lancia Chromium a tutto schermo in modalità kiosk su PC Ubuntu / Debian ("smerdino").
#
# Uso:
#   ./deploy/smerdino-kiosk.sh [--data /path/to/data] [--build]
#
# Alla chiusura (Ctrl+C o kill), invia SIGTERM al server per effettuare
# il salvataggio atomico finale dello stato dell'isola prima di uscire.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${LINEAGE_DATA:-$HOME/lineage-data}"
CONFIG_FILE="${LINEAGE_CONFIG:-$REPO_DIR/sim/config/smerdino.toml}"
DIST_DIR="$REPO_DIR/renderer/dist-kiosk"
PORT="${LINEAGE_PORT:-8080}"
URL="http://localhost:${PORT}/?cap=30"

# Parsing argomenti opzionali
DO_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data)
      DATA_DIR="$2"
      shift 2
      ;;
    --build)
      DO_BUILD=1
      shift
      ;;
    *)
      echo "Opzione sconosciuta: $1" >&2
      exit 1
      ;;
  esac
done

echo "=== Lineage-Smerdino Kiosk ==="
echo "Repo:   $REPO_DIR"
echo "Data:   $DATA_DIR"
echo "Config: $CONFIG_FILE"

# 1. Verifica ambiente Python / uv
if [ ! -d "$REPO_DIR/.venv" ]; then
  echo "[!] Virtualenv non trovato in $REPO_DIR/.venv. Esegui 'uv sync' prima di avviare." >&2
  exit 1
fi
PYTHON="$REPO_DIR/.venv/bin/python"

# 2. Build del renderer se mancante o richiesta
if [ ! -f "$DIST_DIR/index.html" ] || [ "$DO_BUILD" -eq 1 ]; then
  echo "[*] Compilazione renderer kiosk (dist-kiosk)..."
  if ! command -v npm &>/dev/null; then
    echo "[!] npm non trovato nel PATH. Installa Node.js/npm per compilare il renderer." >&2
    exit 1
  fi
  (cd "$REPO_DIR/renderer" && npm run build:kiosk)
fi

# 3. Individuazione browser
BROWSER_BIN=""
for candidate in chromium-browser chromium google-chrome google-chrome-stable; do
  if command -v "$candidate" &>/dev/null; then
    BROWSER_BIN="$(command -v "$candidate")"
    break
  fi
done

if [ -z "$BROWSER_BIN" ]; then
  echo "[!] Nessun browser Chromium trovato nel PATH. Installa chromium o google-chrome." >&2
  exit 1
fi
echo "Browser: $BROWSER_BIN"

# Crea directory dati se non esiste
mkdir -p "$DATA_DIR"

# 4. Avvio server (se non già attivo su porta 8080)
SERVER_PID=""
cleanup() {
  echo ""
  echo "[*] Chiusura in corso..."
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[*] Invio SIGTERM al server Lineage (salvataggio atomico dello stato)..."
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "[✓] Server arrestato e stato salvato."
  fi
}
trap cleanup EXIT INT TERM

if curl -s "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  echo "[*] Server Lineage già in esecuzione su porta ${PORT}."
else
  echo "[*] Avvio Lineage server headless con Solar Cycle..."
  "$PYTHON" -m lineage_server.main \
    --data "$DATA_DIR" \
    --dist "$DIST_DIR" \
    --config "$CONFIG_FILE" \
    --solar \
    --headless &
  SERVER_PID=$!

  # Attesa che il server risponda a /status
  echo -n "[*] In attesa del server..."
  READY=0
  for _ in {1..30}; do
    if curl -s "http://localhost:${PORT}/status" >/dev/null 2>&1; then
      READY=1
      echo " pronto!"
      break
    fi
    sleep 0.5
    echo -n "."
  done

  if [ "$READY" -ne 1 ]; then
    echo ""
    echo "[!] Timeout nell'avvio del server Lineage." >&2
    exit 1
  fi
fi

# 5. Avvio browser Chromium in modalità Kiosk
echo "[*] Avvio visualizzatore Kiosk..."
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
  --user-data-dir="$HOME/.lineage-smerdino-kiosk" \
  "$URL"
