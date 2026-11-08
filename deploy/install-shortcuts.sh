#!/usr/bin/env bash
# ==============================================================================
# Install Lineage: Terrarium desktop shortcut into the Linux desktop environment
# (~/.local/share/applications/lineage-terrarium.desktop).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
APPS_DIR="$HOME/.local/share/applications"

mkdir -p "$ICON_DIR" "$APPS_DIR"

# Generate PNG icon if Python + Pillow is available
if [[ -x "$REPO_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$REPO_DIR/.venv/bin/python"
elif command -v uv >/dev/null 2>&1; then
  PYTHON_BIN="uv run python"
else
  PYTHON_BIN="python3"
fi

$PYTHON_BIN -c "from lineage_server.tray import create_tray_icon_image; img = create_tray_icon_image(size=256); img.save('$ICON_DIR/lineage-terrarium.png')" || true

CAT <<EOF > "$APPS_DIR/lineage-terrarium.desktop"
[Desktop Entry]
Name=Lineage: Terrarium
Comment=Idle Biological Evolution Simulator & Desktop Biome Companion
Exec=$REPO_DIR/deploy/terrarium-launcher.sh
Icon=lineage-terrarium
Terminal=false
Type=Application
Categories=Game;Simulation;
StartupWMClass=Lineage — Launcher
EOF

chmod +x "$APPS_DIR/lineage-terrarium.desktop"
echo "Linux desktop shortcut created at: $APPS_DIR/lineage-terrarium.desktop"
