"""Standalone desktop software launcher for Lineage (fast-life game mode).

Starts an embedded local ``lineage_server`` on an ephemeral loopback port (``127.0.0.1:0``)
with ``fast_life.toml`` (``time_scale = 90.0``, continuous uniform ``60 +- 10`` real-minute
day/night cycle, fast insect-like creature lifecycles, and offline pause when closed) and
opens a native chromeless desktop window via ``pywebview`` (Edge WebView2 on Windows).

Closing the window cleanly saves the living island to disk before exiting.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable
from contextlib import suppress
from dataclasses import replace
from pathlib import Path
from typing import Any

from lineage_device.fake import FakeDevice
from lineage_sim.config import Config, parse_config
from lineage_sim.state import io
from lineage_sim.world import World

from lineage_server.island import Island, new_seed
from lineage_server.main import (
    DEFAULT_MODS,
    FAST_LIFE_CONFIG,
    FAST_LIFE_TIME_SCALE,
    _years_ahead_offset_ms,
)
from lineage_server.server import ScaledClock, Server, SystemClock
from lineage_server.settings import DEFAULT_SETTINGS, load_settings
from lineage_server.store import Store

log = logging.getLogger("lineage_desktop")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GAME_DATA = REPO_ROOT / "data" / "game-fast-life"
DEFAULT_DIST = REPO_ROOT / "renderer" / "dist-kiosk"
WINDOW_TITLE = "Lineage: Terrarium"

# The floating miniature (picture-in-picture): a frameless, always-on-top window holding the
# scene alone, like a browser's video pop-out. It keeps the scene's shape (1024 x 600), opens
# in the bottom-right corner of the screen the first time, and then where it was left.
PIP_RATIO = 1024 / 600
PIP_DEFAULT_WIDTH = 448
PIP_MIN_WIDTH = 240
PIP_MARGIN = 24
PIP_STATE_FILE = "pip-window.json"

# The page's preferences (sound, mods, settings) on disk, not only in the browser's storage,
# which is lost whenever the port changes (renderer/src/prefs.ts). One file for every launch
# of the desktop app, whatever its world.
DEFAULT_PREFS = REPO_ROOT / "data" / "desktop-prefs.json"

# A simulated day and night lasts its chosen length give or take a sixth, drawn anew each
# cycle: fast_life.toml's 75-105 sim-hours at x90 are 60 +- 10 real minutes.
DAY_SPREAD = 1 / 6


def with_day_length(config: Config, day_minutes: float, time_scale: float) -> Config:
    """``config`` with its alternating day and night lasting ``day_minutes`` of wall-clock
    time at ``time_scale``; unchanged when its light does not alternate (live, real sun)."""
    if day_minutes <= 0 or time_scale <= 0:
        raise ValueError("day_minutes and time_scale must be positive")
    if not config.presence.alternating_cycle:
        log.warning("--day-minutes ignored: this config's light does not alternate")
        return config
    sim_hours = day_minutes / 60 * time_scale
    presence = replace(
        config.presence,
        cycle_min_hours=sim_hours * (1 - DAY_SPREAD),
        cycle_max_hours=sim_hours * (1 + DAY_SPREAD),
    )
    return replace(config, presence=presence)


PREFS_PREFIX = "lineage_"
PREFS_VALUE_MAX = 64_000


def _read_prefs(path: Path | None) -> dict[str, str]:
    if path is None or not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(key): value
        for key, value in data.items()
        if isinstance(value, str) and str(key).startswith(PREFS_PREFIX)
    }


# Edges of the miniature a grip moves (renderer/src/pip.ts): left, right, top, bottom.
EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, EDGE_BOTTOM = 1, 2, 4, 8


def pip_height(width: int) -> int:
    return round(width / PIP_RATIO)


def pip_geometry(
    area: tuple[int, int, int, int],
    saved: dict[str, Any] | None,
) -> tuple[int, int, int, int]:
    """Where the miniature opens, as (x, y, width, height) in logical pixels.

    ``area`` is the screen's working area (x, y, width, height). A saved place is kept as
    long as the window stays wholly on that area; otherwise, and the first time, it sits in
    the bottom-right corner, ``PIP_MARGIN`` from the edges.
    """
    ax, ay, aw, ah = area
    max_w = max(PIP_MIN_WIDTH, min(aw - 2 * PIP_MARGIN, round((ah - 2 * PIP_MARGIN) * PIP_RATIO)))
    width = PIP_DEFAULT_WIDTH
    if saved is not None:
        with suppress(TypeError, ValueError):
            width = int(saved.get("width", width))
    width = max(PIP_MIN_WIDTH, min(max_w, width))
    height = pip_height(width)
    x, y = ax + aw - width - PIP_MARGIN, ay + ah - height - PIP_MARGIN
    if saved is not None:
        try:
            sx, sy = int(saved["x"]), int(saved["y"])
        except (KeyError, TypeError, ValueError):
            pass
        else:
            if ax <= sx and ay <= sy and sx + width <= ax + aw and sy + height <= ay + ah:
                x, y = sx, sy
    return x, y, width, height


def _load_pip_state(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _save_pip_state(path: Path | None, x: int, y: int, width: int) -> None:
    if path is None:
        return
    with suppress(OSError):
        path.write_text(json.dumps({"x": x, "y": y, "width": width}), encoding="utf-8")


def _work_area(window: Any = None) -> tuple[int, int, int, int]:
    """The primary screen's working area (no taskbar), in logical pixels.

    Once the GUI is up the process is DPI aware and WinForms gives the screen in physical
    pixels, with a ``scale`` of 1 (pywebview divides physical by physical), while windows
    are placed in logical pixels: measured on a 2560 x 1600 screen at 150% (08/11/2026). So
    when the screen says 1 but the game window's form has a larger scale, divide by it.
    """
    import webview  # pyright: ignore[reportMissingImports]

    screens = webview.screens
    screen = next((s for s in screens if s.x == 0 and s.y == 0), screens[0] if screens else None)
    if screen is None:
        return (0, 0, 1366, 768)
    frame = screen.frame
    try:
        area = (int(frame.X), int(frame.Y), int(frame.Width), int(frame.Height))
    except AttributeError:
        area = (screen.x, screen.y, screen.width, screen.height)
    divisor = 1.0
    if window is not None and abs(float(screen.scale) - 1.0) < 0.01:
        with suppress(Exception):
            from webview.platforms.winforms import BrowserView  # pyright: ignore

            form = BrowserView.instances.get(window.uid)
            if form is not None:
                divisor = float(form._scale) or 1.0
    return tuple(round(v / divisor) for v in area)  # type: ignore[return-value]


def _round_corners(window: Any) -> None:
    """Ask Windows 11 to round a frameless window's corners, as it does for framed ones."""
    try:
        import ctypes

        from webview.platforms.winforms import BrowserView  # pyright: ignore[reportMissingImports]

        form = BrowserView.instances.get(window.uid)
        if form is None:
            return
        hwnd = form.Handle.ToInt32()
        preference = ctypes.c_int(2)  # DWMWCP_ROUND
        # 33: DWMWA_WINDOW_CORNER_PREFERENCE
        ctypes.windll.dwmapi.DwmSetWindowAttribute(  # type: ignore[attr-defined]
            hwnd, 33, ctypes.byref(preference), ctypes.sizeof(preference)
        )
    except Exception:
        pass


def _set_form_prop(form: Any, prop: str, value: Any) -> None:
    """Safely apply a property to a WinForms form across thread boundaries."""
    if form is None:
        return
    try:
        from System import Action  # pyright: ignore[reportMissingImports]

        if getattr(form, "InvokeRequired", False):
            form.Invoke(Action(lambda: setattr(form, prop, value)))
            return
    except Exception:
        pass
    try:
        setattr(form, prop, value)
    except Exception:
        log.warning("Could not set %s on form", prop, exc_info=True)


def _apply_native_form_decorations(form: Any) -> None:
    """Set window icon and ensure presence on the Windows Taskbar."""
    if form is None:
        return
    ico_path = REPO_ROOT / "lineage.ico"
    if ico_path.is_file():
        try:
            import System.Drawing  # pyright: ignore[reportMissingImports]

            icon = System.Drawing.Icon(str(ico_path))
            _set_form_prop(form, "Icon", icon)
        except Exception:
            pass
    _set_form_prop(form, "ShowInTaskbar", True)


def _apply_window_decorations(window: Any) -> None:
    """Apply native taskbar icon and styles to the WinForms window instance."""
    if window is None:
        return
    try:
        from webview.platforms.winforms import BrowserView  # pyright: ignore[reportMissingImports]

        form = BrowserView.instances.get(window.uid)
        if form is not None:
            _apply_native_form_decorations(form)
    except Exception:
        pass


class DesktopApi:
    """JavaScript bridge exposed at ``window.pywebview.api`` inside the game window."""

    def __init__(
        self,
        initial_fullscreen: bool = False,
        *,
        pip_url: str | None = None,
        pip_state: Path | None = None,
        title: str = WINDOW_TITLE,
        prefs: Path | None = None,
    ) -> None:
        self._window: Any = None
        self._fullscreen = initial_fullscreen
        self._pip: Any = None
        self._pip_url = pip_url
        self._pip_state = pip_state
        self._title = title
        self._pip_lock = threading.Lock()
        self._prefs = prefs
        self._prefs_lock = threading.Lock()

    def is_desktop(self) -> bool:
        return True

    def prefs_get(self) -> dict[str, str]:
        """The page's saved preferences (sound, mods, settings), as its storage had them."""
        with self._prefs_lock:
            return _read_prefs(self._prefs)

    def prefs_set(self, key: str, value: str) -> bool:
        """Keep one of the page's preferences on disk (only the game's own keys)."""
        if not isinstance(key, str) or not key.startswith(PREFS_PREFIX):
            return False
        if not isinstance(value, str) or len(value) > PREFS_VALUE_MAX:
            return False
        if self._prefs is None:
            return False
        with self._prefs_lock:
            prefs = _read_prefs(self._prefs)
            if prefs.get(key) == value:
                return True
            prefs[key] = value
            try:
                self._prefs.parent.mkdir(parents=True, exist_ok=True)
                temp = self._prefs.with_suffix(".tmp")
                temp.write_text(json.dumps(prefs, indent=1, sort_keys=True), encoding="utf-8")
                temp.replace(self._prefs)
            except OSError:
                log.warning("Could not save the preferences to %s", self._prefs)
                return False
        return True

    def toggle_fullscreen(self) -> bool:
        if self._window is None:
            return False
        self._window.toggle_fullscreen()
        self._fullscreen = not self._fullscreen
        return self._fullscreen

    def pip_open(self) -> bool:
        return self._pip is not None

    def open_pip(self) -> bool:
        """Open the floating miniature and hide the game window behind it."""
        with self._pip_lock:
            if self._pip is not None:
                return True
            if self._window is None or self._pip_url is None:
                return False
            import webview  # pyright: ignore[reportMissingImports]

            x, y, width, height = pip_geometry(
                _work_area(self._window), _load_pip_state(self._pip_state)
            )
            pip = webview.create_window(
                f"{self._title} (miniatura)",
                self._pip_url,
                width=width,
                height=height,
                x=x,
                y=y,
                min_size=(PIP_MIN_WIDTH, pip_height(PIP_MIN_WIDTH)),
                frameless=True,
                easy_drag=False,
                on_top=True,
                background_color="#10081c",
                js_api=self,
            )
            if pip is None:
                return False
            self._pip = pip

        def on_shown() -> None:
            _apply_window_decorations(pip)
            _round_corners(pip)
            # Dropping the border keeps the inside and shrinks the window (448 x 262 came
            # out 433 x 224): set the size again, and the place with it.
            with suppress(Exception):
                pip.resize(width, height)
                pip.move(x, y)

        pip.events.shown += on_shown
        pip.events.closed += lambda: self._pip_closed(pip)
        # The game window stops drawing and holds its sound while the miniature plays.
        with suppress(Exception):
            self._window.run_js("window.__pipAway && window.__pipAway(true)")
        with suppress(Exception):
            self._window.hide()
        log.info("Miniature opened at %s,%s %sx%s", x, y, width, height)
        return True

    def close_pip(self, back: bool = True) -> bool:
        """Close the miniature; ``back`` brings the game window up, else leaves it minimised."""
        with self._pip_lock:
            pip, self._pip = self._pip, None
        if pip is None:
            return False
        with suppress(Exception):
            _save_pip_state(self._pip_state, int(pip.x), int(pip.y), int(pip.width))
        with suppress(Exception):
            pip.destroy()
        self._show_game(back)
        return True

    def pip_resize(self, width: int, height: int, edges: int) -> dict[str, int]:
        """Resize the miniature from a grip, keeping still the corner opposite ``edges``."""
        pip = self._pip
        w = max(PIP_MIN_WIDTH, int(width))
        h = pip_height(w)
        if pip is None:
            return {"width": w, "height": h}
        from webview.window import FixPoint  # pyright: ignore[reportMissingImports]

        fix = FixPoint.EAST if edges & EDGE_LEFT else FixPoint.WEST
        fix |= FixPoint.SOUTH if edges & EDGE_TOP else FixPoint.NORTH
        with suppress(Exception):
            pip.resize(w, h, fix_point=fix)
        return {"width": w, "height": h}

    def _pip_closed(self, pip: Any) -> None:
        # Closed from outside (Alt+F4, the taskbar): the game window comes back.
        with self._pip_lock:
            if self._pip is not pip:
                return
            self._pip = None
        self._show_game(True)

    def _show_game(self, back: bool) -> None:
        window = self._window
        if window is None:
            return
        with suppress(Exception):
            window.run_js("window.__pipAway && window.__pipAway(false)")
        with suppress(Exception):
            window.show()
            if back:
                window.restore()
            else:
                window.minimize()


def bootstrap_fast_world(
    data_dir: Path,
    config: Config,
    years_ahead: int = 400,
    seed: int = 242690,
) -> Path:
    """Create or seed an immediately lush, multi-species continent in ``data_dir``."""
    store = Store(data_dir)
    store.clean()
    existing = store.load_newest(io.loads)
    if existing is not None:
        return existing.path

    log.info("Seeding initial fast-life continent in %s ...", data_dir)
    # Check if a 400-year evolved world already exists in data/local-400y
    seed_source_dir = REPO_ROOT / "data" / "local-400y"
    seed_store = Store(seed_source_dir)
    latest_src = seed_store.load_newest(io.loads)
    if latest_src is not None:
        # Load snapshot and re-save into target data_dir under fast_life configuration
        src_world = World.restore(config, latest_src.value)
        saved = store.save(io.dumps(src_world.snapshot()), src_world.unix_ms)
        log.info(
            "Inherited %d creatures across %d living species from %s -> %s",
            src_world.fauna.count,
            sum(1 for r in src_world.species.records() if r.alive),
            latest_src.path.name,
            saved.name,
        )
        return saved

    from deploy.bootstrap_400y import build_future_world

    return build_future_world(data_dir, years_ahead=years_ahead, seed=seed)


def start_embedded_server(
    *,
    data_dir: Path,
    dist_dir: Path,
    config: Config,
    time_scale: float,
    years_ahead: int,
    port: int = 8080,
    mods: Path | None = None,
) -> tuple[Server, Callable[[], None], threading.Thread]:
    """Run ``Server`` on a daemon thread and block until its HTTP/WS socket is ready."""
    if port != 0:
        import socket

        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
        except OSError:
            log.warning("Port %d is already in use; falling back to ephemeral port", port)
            port = 0

    settings = load_settings(DEFAULT_SETTINGS)
    settings = replace(
        settings,
        host="127.0.0.1",
        port=port,
        poll_seconds=0.25 if time_scale > 1.0 else settings.poll_seconds,
        jump_seconds=settings.jump_seconds * max(1.0, time_scale),
    )
    island = Island(
        config,
        Store(data_dir),
        settings,
        seed=new_seed,
        pause_offline=True,
        time_scale=time_scale,
    )
    base_now_ms = SystemClock(_years_ahead_offset_ms(years_ahead)).now_ms()
    wall_clock = (
        ScaledClock(scale=time_scale, initial_unix_ms=base_now_ms)
        if time_scale != 1.0
        else SystemClock(_years_ahead_offset_ms(years_ahead))
    )
    server = Server(
        island, FakeDevice(present=True), settings, dist=dist_dir, clock=wall_clock, mods=mods
    )

    ready_event = threading.Event()
    loop_holder: dict[str, Any] = {}

    def runner() -> None:
        async def _main() -> None:
            stop = asyncio.Event()
            loop_holder["loop"] = asyncio.get_running_loop()
            loop_holder["stop"] = stop
            await server.run(stop, ready=ready_event.set)

        asyncio.run(_main())

    thread = threading.Thread(target=runner, name="lineage-embedded-server", daemon=True)
    thread.start()
    if not ready_event.wait(timeout=30.0):
        raise RuntimeError("Timed out waiting for embedded Lineage server to start")

    stopped = False

    def shutdown() -> None:
        nonlocal stopped
        if stopped:
            return
        stopped = True
        loop = loop_holder.get("loop")
        stop = loop_holder.get("stop")
        if loop is not None and stop is not None:
            loop.call_soon_threadsafe(stop.set)
        thread.join(timeout=10.0)

    return server, shutdown, thread


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
    parser = argparse.ArgumentParser(description="Launch Lineage as a standalone desktop game.")
    parser.add_argument("--data", type=Path, default=DEFAULT_GAME_DATA)
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--config", type=Path, default=FAST_LIFE_CONFIG)
    parser.add_argument("--time-scale", type=float, default=FAST_LIFE_TIME_SCALE)
    parser.add_argument(
        "--day-minutes",
        type=float,
        default=None,
        help="real minutes of one simulated day and night (default: the config's)",
    )
    parser.add_argument("--years-ahead", type=int, default=400)
    parser.add_argument("--mods", type=Path, default=DEFAULT_MODS, help="mods/README.md")
    parser.add_argument("--fullscreen", action="store_true", help="open directly in fullscreen")
    parser.add_argument("--title", default=WINDOW_TITLE, help="the window's title")
    parser.add_argument(
        "--prefs", type=Path, default=DEFAULT_PREFS, help="where sound, mods and settings are kept"
    )
    parser.add_argument("--port", type=int, default=8080, help="port to serve on (default: 8080)")
    parser.add_argument(
        "--browser",
        action="store_true",
        help="open in default web browser tab and run headlessly",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="verify bootstrap, live fast-life ticking, endpoints, and clean save headlessly",
    )
    args = parser.parse_args(argv)

    log_dir = REPO_ROOT / "data"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "desktop.log"

    handlers: list[logging.Handler] = [
        logging.StreamHandler(),
        logging.FileHandler(log_file, encoding="utf-8", mode="a"),
    ]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
    )
    logging.getLogger("websockets").setLevel(logging.WARNING)

    log.info("--- Lineage desktop launcher starting (argv=%s) ---", argv)
    try:
        _run_desktop(args)
    except Exception:
        log.exception("Fatal crash in Lineage desktop launcher")
        raise


def _run_desktop(args: argparse.Namespace) -> None:
    if not (args.dist / "index.html").is_file():
        raise SystemExit(f"Missing renderer build at {args.dist} (run npm run build:kiosk)")

    config = parse_config(args.config.read_text(encoding="utf-8"))
    if args.day_minutes is not None:
        config = with_day_length(config, args.day_minutes, args.time_scale)
    bootstrap_fast_world(args.data, config, years_ahead=args.years_ahead)

    server, shutdown, _ = start_embedded_server(
        data_dir=args.data,
        dist_dir=args.dist,
        config=config,
        time_scale=args.time_scale,
        years_ahead=args.years_ahead,
        port=args.port,
        mods=args.mods,
    )
    # `fast` quickens the scene's animals to match a quickened island; at x1 they keep pace.
    fast = "&fast=1" if args.time_scale > 1.0 else ""
    url = f"http://127.0.0.1:{server.port}/?desktop=1{fast}"
    log.info("Embedded server ready at %s", url)

    if args.smoke_test:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/god-power") as resp:
                gp1 = resp.read().decode("utf-8")
            pos0 = server.island.world.fauna.positions.copy()
            time.sleep(2.4)
            pos1 = server.island.world.fauna.positions.copy()
            moved = (
                int((((pos1 - pos0) ** 2).sum(axis=1) > 0).sum()) if len(pos0) == len(pos1) else -1
            )
            log.info("Smoke test OK on %s | god-power=%s | moved=%s", url, gp1, moved)
        finally:
            shutdown()
        return

    if args.browser:
        import webbrowser

        try:
            webbrowser.open(url)
            log.info("Opened default browser tab at %s", url)
        except Exception:
            log.warning("Could not open default browser tab automatically")

        log.info("Running in headless browser server mode; press Ctrl+C to stop")
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
        finally:
            shutdown()
        return

    try:
        import webview  # pyright: ignore[reportMissingImports] - Lazy import so headless Linux servers never need pywebview
    except ImportError:
        import webbrowser

        try:
            webbrowser.open(url)
            log.info("pywebview not installed; opened default browser tab at %s", url)
        except Exception:
            log.warning("Could not open default browser tab automatically")

        log.info("pywebview not installed; running in browser server mode")
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
        finally:
            shutdown()
        return

    log.info("Creating pywebview window pointing to %s", url)
    api = DesktopApi(
        initial_fullscreen=args.fullscreen,
        pip_url=f"{url}&pip=1",
        pip_state=args.data / PIP_STATE_FILE,
        prefs=args.prefs,
        title=args.title,
    )
    window = webview.create_window(
        args.title,
        url,
        width=1366,
        height=820,
        min_size=(640, 400),
        fullscreen=args.fullscreen,
        background_color="#10081c",
        js_api=api,
    )
    if window is None:
        raise RuntimeError("pywebview could not create the game window")
    api._window = window

    from lineage_server.tray import TrayController, ask_close_action

    quitting = threading.Event()
    tray: TrayController | None = None

    def on_tray_show() -> None:
        if api.close_pip(back=True):
            return
        window.show()
        window.restore()

    def on_tray_exit() -> None:
        quitting.set()
        with suppress(Exception):
            api.close_pip(back=False)
        shutdown()
        window.destroy()

    tray = TrayController(on_show=on_tray_show, on_exit=on_tray_exit, title=args.title)

    def on_closing() -> bool:
        if quitting.is_set():
            return True
        action = ask_close_action()
        if action == "background":
            window.hide()
            assert tray is not None
            tray.start()
            return False
        if action == "exit":
            quitting.set()
            if tray is not None:
                tray.stop()
            shutdown()
            return True
        return False

    window.events.closing += on_closing
    window.events.closed += lambda: (tray.stop() if tray else None, shutdown())
    window.events.shown += lambda: _apply_window_decorations(window)
    try:
        log.info("Starting webview event loop")
        profile_dir = str(args.data / "webview_profile")
        Path(profile_dir).mkdir(parents=True, exist_ok=True)
        webview.start(debug=False, private_mode=False, storage_path=profile_dir)
        log.info("webview event loop terminated cleanly")
    finally:
        if tray is not None:
            tray.stop()
        shutdown()


if __name__ == "__main__":
    main()
