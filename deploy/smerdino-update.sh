#!/usr/bin/env bash
# ==============================================================================
# deploy/smerdino-update.sh — Aggiornamento rapido o automatico per Smerdino
# ==============================================================================
# Esegue il pull degli aggiornamenti da GitHub.
# Se ci sono modifiche:
#  1. Esegue uv sync (se cambiano dipendenze Python / uv.lock)
#  2. Ricompila il renderer (se cambiano file in renderer/)
#  3. Riavvia in modo sicuro il server di simulazione (se cambia codice Python o config)
#     salvando lo stato del mondo tramite SIGTERM prima del riavvio
#  4. Ricarica la pagina del kiosk Chromium (se attivo)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_DIR"

# Controlla se ci sono commit nuovi da remoto
git fetch origin main -q

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  # Nessun aggiornamento disponibile
  exit 0
fi

echo "[*] Trovati nuovi aggiornamenti su origin/main!"
echo "    Locale: $LOCAL_COMMIT"
echo "    Remoto: $REMOTE_COMMIT"

# Lista file modificati
CHANGED_FILES="$(git diff --name-only HEAD origin/main)"

# Esegui merge veloce
git pull --ff-only origin main

# 1. Aggiorna dipendenze se necessario
if echo "$CHANGED_FILES" | grep -qE "(uv\.lock|pyproject\.toml)"; then
  echo "[*] Aggiornamento dipendenze Python con uv sync..."
  uv sync
fi

# 2. Ricompila renderer kiosk se sono cambiati file in renderer/
RELOAD_KIOSK=0
if echo "$CHANGED_FILES" | grep -qE "^renderer/"; then
  echo "[*] Rilevate modifiche al renderer: ricompilazione dist-kiosk..."
  (cd renderer && npm run build:kiosk)
  RELOAD_KIOSK=1
fi

# 3. Riavvia il server di simulazione se è cambiato il codice Python o la config
if echo "$CHANGED_FILES" | grep -qE "^(sim/|server/|device/)"; then
  echo "[*] Riavvio del server di simulazione con salvataggio sicuro..."
  if systemctl --user is-active --quiet lineage-smerdino-server.service 2>/dev/null; then
    systemctl --user restart lineage-smerdino-server.service
    echo "[✓] Servizio lineage-smerdino-server riavviato."
  fi
fi

# 4. Ricarica visualizzatore Kiosk se attivo
if [ "$RELOAD_KIOSK" -eq 1 ]; then
  if systemctl --user is-active --quiet lineage-smerdino-kiosk.service 2>/dev/null; then
    echo "[*] Riavvio servizio kiosk..."
    systemctl --user restart lineage-smerdino-kiosk.service
  elif command -v xdotool &>/dev/null && DISPLAY=:0 xdotool search --onlyvisible --class chromium windowactivate --sync key F5 2>/dev/null; then
    echo "[✓] Pagina Chromium ricaricata via xdotool."
  fi
fi

echo "[✓] Aggiornamento completato con successo al commit $(git rev-parse --short HEAD)!"
