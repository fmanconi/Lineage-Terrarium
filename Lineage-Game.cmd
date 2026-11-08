@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\pythonw.exe" (
    start "" "%~dp0.venv\Scripts\pythonw.exe" -m lineage_server.desktop %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    start "" "%~dp0.venv\Scripts\python.exe" -m lineage_server.desktop %*
) else (
    echo Python virtual environment not found in %~dp0.venv
    pause
)
