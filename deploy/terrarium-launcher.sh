#!/usr/bin/env bash
# ==============================================================================
# Lineage launcher on Linux: pick a world under data/, the pace (fast-life x90 or
# true real time x1) and the user mods, then launch the desktop app
# (lineage_server.desktop). Opens a pywebview window when pywebview is installed,
# otherwise the default browser. Windows: Lineage-Launcher.cmd at the repo's root.
#
# Usage:
#   ./deploy/terrarium-launcher.sh [--browser] [--data DIR] [--mods DIR]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

if [[ -x "$REPO_DIR/.venv/bin/python" ]]; then
  exec "$REPO_DIR/.venv/bin/python" -m lineage_server.launcher "$@"
elif command -v uv >/dev/null 2>&1; then
  exec uv run python -m lineage_server.launcher "$@"
else
  echo "No .venv in $REPO_DIR and no uv in PATH: run 'uv sync' there first." >&2
  exit 1
fi
