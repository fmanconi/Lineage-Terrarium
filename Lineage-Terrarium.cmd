@echo off
rem Lineage: Terrarium - the standalone desktop app (fast-life island in its own window).
rem Extra arguments go to lineage_server.desktop (e.g. --fullscreen, --browser).
setlocal
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\pythonw.exe" (
    start "Lineage: Terrarium" "%~dp0.venv\Scripts\pythonw.exe" -m lineage_server.desktop --title "Lineage: Terrarium" %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    start "Lineage: Terrarium" "%~dp0.venv\Scripts\python.exe" -m lineage_server.desktop --title "Lineage: Terrarium" %*
) else (
    echo Python virtual environment not found in %~dp0.venv
    echo Run "uv sync" in this folder first.
    pause
)
