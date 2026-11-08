"""Lineage's launcher: the desktop app's front door.

A small pixel-art window (``assets/launcher.html``) to pick a world under ``data/``, the
island's pace (fast-life x90 or true real time x1), which user mods are on (``mods/``,
``mods/README.md``) and whether to open full screen; its Launch button starts the game
(``lineage_server.desktop``) as a process of its own and closes the launcher.

The window is a ``pywebview`` one, the page calling Python through ``window.pywebview.api``
(`LauncherApi`). Without pywebview the same page opens in the default browser, served on a
loopback port, and calls the same methods over HTTP (``POST /api/<method>``, with the
launch's token in a header so no other site can call them).

Usage::

    uv run python -m lineage_server.launcher [--data data] [--mods mods] [--browser]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import lzma
import re
import secrets
import subprocess
import sys
import threading
import webbrowser
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from lineage_sim.state import io

from lineage_server.main import DEFAULT_MODS, FAST_LIFE_CONFIG, FAST_LIFE_TIME_SCALE
from lineage_server.server import MOD_ID, find_mods
from lineage_server.store import save_instant, write_atomic

log = logging.getLogger("lineage_launcher")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = REPO_ROOT / "data"
TERRARIUM_CONFIG = REPO_ROOT / "sim" / "config" / "terrarium.toml"
LAUNCHER_PAGE = Path(__file__).with_name("assets") / "launcher.html"
WINDOW_TITLE = "Lineage — Launcher"
# A world is a folder of data/: no separators, no leading dot.
WORLD_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
# A world with no save yet is bootstrapped by the desktop app from the 400-year island.
NEW_WORLD_YEARS_AHEAD = 400


@dataclass(frozen=True)
class Mode:
    label: str
    config: Path
    time_scale: float


MODES: dict[str, Mode] = {
    "fast": Mode("⚡ Fast-Life (x90)", FAST_LIFE_CONFIG, FAST_LIFE_TIME_SCALE),
    "realtime": Mode("🌿 True Real-Time (x1)", TERRARIUM_CONFIG, 1.0),
}

Spawn = Callable[[Sequence[str]], int]


def spawn_detached(command: Sequence[str]) -> int:
    """Start ``command`` in the repository, detached from the launcher; returns its pid."""
    options: dict[str, Any] = {
        "cwd": REPO_ROOT,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        options["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    return subprocess.Popen(list(command), **options).pid


def creature_count(save: Path) -> int | None:
    """How many creatures a save holds, read from its state tree without building a world;
    None for a save that cannot be read."""
    try:
        tree = io.decode(lzma.decompress(save.read_bytes(), format=lzma.FORMAT_XZ))
        return len(tree["subsystems"]["fauna"]["ids"])
    except Exception:
        log.warning("could not count the creatures of %s", save, exc_info=True)
        return None


class LauncherApi:
    """What the launcher's page calls. pywebview exposes every public method; state is kept
    in private attributes so it does not walk into them."""

    def __init__(
        self,
        data: Path = DEFAULT_DATA,
        mods: Path = DEFAULT_MODS,
        *,
        spawn: Spawn = spawn_detached,
        on_launched: Callable[[], None] = lambda: None,
        today: Callable[[], dt.date] = dt.date.today,
    ) -> None:
        self._data = data
        self._mods = mods
        self._spawn = spawn
        self._on_launched = on_launched
        self._today = today
        self._counts: dict[tuple[Path, float], int | None] = {}

    # --- Worlds ---------------------------------------------------------------------------

    def list_worlds(self) -> list[dict[str, Any]]:
        """Every folder of ``data/`` holding saves: its name, the creatures of its newest
        save, the island's date in that save and when it was written. Newest played first."""
        worlds: list[dict[str, Any]] = []
        if not self._data.is_dir():
            return worlds
        for folder in sorted(self._data.iterdir(), key=lambda p: p.name):
            saves_dir = folder / "saves"
            if not WORLD_NAME.fullmatch(folder.name) or not saves_dir.is_dir():
                continue
            saves = sorted(p for p in saves_dir.iterdir() if save_instant(p.name) is not None)
            archives = folder / "archives"
            ended = len(list(archives.glob("*.lzma"))) if archives.is_dir() else 0
            world: dict[str, Any] = {
                "name": folder.name,
                "saves": len(saves),
                "ended_worlds": ended,
                "creatures": None,
                "island_time": None,
                "saved_at": None,
            }
            if saves:
                newest = saves[-1]
                mtime = newest.stat().st_mtime
                key = (newest, mtime)
                if key not in self._counts:
                    self._counts[key] = creature_count(newest)
                instant = save_instant(newest.name)
                world["creatures"] = self._counts[key]
                world["island_time"] = instant.isoformat() if instant is not None else None
                world["saved_at"] = dt.datetime.fromtimestamp(mtime, tz=dt.UTC).isoformat()
            worlds.append(world)
        worlds.sort(key=lambda w: w["saved_at"] or "", reverse=True)
        return worlds

    # --- Mods -----------------------------------------------------------------------------

    def list_mods(self) -> list[dict[str, Any]]:
        """Every user mod, as ``/api/mods`` lists it, with ``enabled`` always given."""
        return [
            {**mod, "enabled": mod.get("enabled", True) is not False} for mod in self._mods_found()
        ]

    def set_mod_enabled(self, mod_id: str, enabled: bool) -> dict[str, Any]:
        """Keep a client mod in the scene or out of it (``enabled`` in its ``mod.json``)."""
        if not isinstance(mod_id, str) or not MOD_ID.fullmatch(mod_id):
            return {"ok": False, "error": "not a mod id"}
        if not any(m["id"] == mod_id and m["kind"] == "client" for m in self._mods_found()):
            return {"ok": False, "error": f"no client mod {mod_id!r}"}
        path = self._mods / "client" / mod_id / "mod.json"
        meta = json.loads(path.read_text(encoding="utf-8"))
        meta["enabled"] = bool(enabled)
        write_atomic(path, (json.dumps(meta, indent=2, ensure_ascii=False) + "\n").encode())
        return {"ok": True, "id": mod_id, "enabled": bool(enabled)}

    def _mods_found(self) -> list[dict[str, Any]]:
        return find_mods(self._mods) if self._mods.is_dir() else []

    # --- Launching ------------------------------------------------------------------------

    def modes(self) -> list[dict[str, Any]]:
        return [
            {"id": key, "label": mode.label, "time_scale": mode.time_scale}
            for key, mode in MODES.items()
        ]

    def command(self, world_name: str, mode: str, fullscreen: bool) -> list[str]:
        """The desktop app's command line for a world, a pace and a window."""
        if not isinstance(world_name, str) or not WORLD_NAME.fullmatch(world_name):
            raise ValueError(f"not a world name: {world_name!r}")
        if mode not in MODES:
            raise ValueError(f"not a mode: {mode!r}")
        chosen = MODES[mode]
        folder = self._data / world_name
        command = [
            sys.executable,
            "-m",
            "lineage_server.desktop",
            "--data",
            str(folder),
            "--config",
            str(chosen.config),
            "--time-scale",
            repr(chosen.time_scale),
            "--years-ahead",
            str(self._years_ahead(folder)),
            "--mods",
            str(self._mods),
            "--title",
            f"Lineage: {world_name}",
        ]
        if fullscreen:
            command.append("--fullscreen")
        return command

    def launch(self, world_name: str, mode: str, fullscreen: bool = False) -> dict[str, Any]:
        """Start the game on ``world_name`` and close the launcher."""
        try:
            command = self.command(world_name, mode, bool(fullscreen))
        except ValueError as error:
            return {"ok": False, "error": str(error)}
        log.info("launching %s", command)
        try:
            pid = self._spawn(command)
        except OSError as error:
            log.exception("could not start the game")
            return {"ok": False, "error": str(error)}
        # Close after the page has had its answer.
        threading.Timer(0.5, self._on_launched).start()
        return {"ok": True, "pid": pid, "world": world_name, "mode": mode}

    def _years_ahead(self, folder: Path) -> int:
        """How far ahead of today the island's calendar runs: the wall clock is shifted so
        that the newest save is not in its future (the 400-year island lives in 2426)."""
        saves_dir = folder / "saves"
        if not saves_dir.is_dir():
            return NEW_WORLD_YEARS_AHEAD
        instants = [i for p in saves_dir.iterdir() if (i := save_instant(p.name)) is not None]
        if not instants:
            return NEW_WORLD_YEARS_AHEAD
        return max(0, max(instants).year - self._today().year)


# --- Without pywebview: the page in the browser, the API over loopback HTTP ---------------

BRIDGE_METHODS = ("list_worlds", "list_mods", "set_mod_enabled", "modes", "launch")
TOKEN_HEADER = "X-Launcher-Token"


def bridge_server(api: LauncherApi, page: bytes, token: str) -> ThreadingHTTPServer:
    """An HTTP server on a free loopback port: ``GET /`` the page, ``POST /api/<method>``
    with ``{"args": [...]}`` and the token header calls ``api``'s method."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path.split("?", 1)[0] not in ("/", "/index.html"):
                self._send(HTTPStatus.NOT_FOUND, b"not found\n", "text/plain")
                return
            self._send(HTTPStatus.OK, page, "text/html; charset=utf-8")

        def do_POST(self) -> None:
            name = self.path.removeprefix("/api/")
            if self.headers.get(TOKEN_HEADER) != token:
                self._send(HTTPStatus.FORBIDDEN, b"{}", "application/json")
                return
            if not self.path.startswith("/api/") or name not in BRIDGE_METHODS:
                self._send(HTTPStatus.NOT_FOUND, b"{}", "application/json")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                args = body.get("args", [])
                if not isinstance(args, list):
                    raise ValueError("args is not a list")
                result = getattr(api, name)(*args)
            except (ValueError, TypeError) as error:
                self._send(
                    HTTPStatus.BAD_REQUEST,
                    json.dumps({"error": str(error)}).encode(),
                    "application/json",
                )
                return
            self._send(HTTPStatus.OK, json.dumps(result).encode(), "application/json")

        def _send(self, status: HTTPStatus, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def _run_in_browser(api: LauncherApi, page: bytes, closed: threading.Event) -> None:
    token = secrets.token_urlsafe(16)
    server = bridge_server(api, page, token)
    url = f"http://127.0.0.1:{server.server_address[1]}/?token={token}"
    thread = threading.Thread(target=server.serve_forever, name="launcher-bridge", daemon=True)
    thread.start()
    log.info("launcher at %s", url)
    webbrowser.open(url)
    try:
        closed.wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


APP_USER_MODEL_ID = "Federico.Lineage.Terrarium.1"


def _set_app_user_model_id() -> None:
    try:
        import sys

        if sys.platform == "win32":
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)
    except Exception:
        pass


def main(argv: list[str] | None = None) -> None:
    _set_app_user_model_id()
    parser = argparse.ArgumentParser(description="Pick a world, a pace and mods; launch Lineage.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="the worlds' folders")
    parser.add_argument("--mods", type=Path, default=DEFAULT_MODS, help="mods/README.md")
    parser.add_argument("--browser", action="store_true", help="open in the browser, not a window")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    page = LAUNCHER_PAGE.read_bytes()
    closed = threading.Event()
    window: Any = None

    def on_launched() -> None:
        closed.set()
        if window is not None:
            window.destroy()

    api = LauncherApi(args.data.resolve(), args.mods.resolve(), on_launched=on_launched)

    webview: Any = None
    if not args.browser:
        try:
            import webview  # Optional: without it the page opens in the browser.
        except ImportError:
            log.info("pywebview is not installed: opening the launcher in the browser")
    if webview is None:
        _run_in_browser(api, page, closed)
        return

    window = webview.create_window(
        WINDOW_TITLE,
        html=page.decode("utf-8"),
        js_api=api,
        width=900,
        height=640,
        min_size=(720, 520),
        background_color="#10081c",
    )
    webview.start(debug=False)


if __name__ == "__main__":
    main()
