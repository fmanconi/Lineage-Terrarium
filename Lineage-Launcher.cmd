@echo off
rem Lineage launcher: pick a world, the pace (fast-life x90 or real time x1) and the mods,
rem then launch the desktop app. Without pywebview it opens in the default browser.
rem Extra arguments go to lineage_server.launcher (e.g. --browser, --data DIR, --mods DIR).
setlocal
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\pythonw.exe" (
    start "Lineage Launcher" "%~dp0.venv\Scripts\pythonw.exe" -m lineage_server.launcher %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    start "Lineage Launcher" "%~dp0.venv\Scripts\python.exe" -m lineage_server.launcher %*
) else (
    echo Python virtual environment not found in %~dp0.venv
    echo Run "uv sync" in this folder first.
    pause
)
