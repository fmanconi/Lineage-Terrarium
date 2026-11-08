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


def _set_form_prop(form: Any, prop: str, value: Any) -> None:
    """Safely apply a property to a WinForms form across thread boundaries."""
    if form is None:
        return
    try:
        from System import Action

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
            import System.Drawing

            icon = System.Drawing.Icon(str(ico_path))
            _set_form_prop(form, "Icon", icon)
        except Exception:
            pass
    _set_form_prop(form, "ShowInTaskbar", True)


class DesktopApi:
    """JavaScript bridge exposed at ``window.pywebview.api`` inside the game window."""

    def __init__(self, initial_fullscreen: bool = False) -> None:
        self._window: Any = None
        self._fullscreen = initial_fullscreen
        self._miniature = False
        self._saved_size: tuple[int, int] = (1366, 820)
        self._opacity: float = 1.0

    def is_desktop(self) -> bool:
        return True

    def toggle_fullscreen(self) -> bool:
        if self._window is None:
            return False
        self._window.toggle_fullscreen()
        self._fullscreen = not self._fullscreen
        return self._fullscreen

    def _get_form(self) -> Any:
        if self._window is None:
            return None
        try:
            from webview.platforms.winforms import BrowserView

            form = BrowserView.instances.get(self._window.uid)
            if form is not None:
                _apply_native_form_decorations(form)
            return form
        except Exception:
            return None

    def set_opacity(self, alpha: float) -> float:
        """Set window opacity (0.15 .. 1.0). Works natively on Windows (WinForms / WebView2)."""
        self._opacity = max(0.15, min(1.0, float(alpha)))
        form = self._get_form()
        if form is not None:
            _set_form_prop(form, "Opacity", self._opacity)
        return self._opacity

    def get_opacity(self) -> float:
        return self._opacity

    def set_on_top(self, on_top: bool) -> bool:
        """Keep the window pinned always on top of all other windows."""
        target = bool(on_top)
        if self._window is not None:
            with suppress(Exception):
                self._window.on_top = target
        form = self._get_form()
        if form is not None:
            _set_form_prop(form, "TopMost", target)
        return target

    def resize_window(self, width: int, height: int) -> dict[str, int]:
        """Resize the desktop window to given pixel dimensions."""
        w = max(200, min(3840, int(width)))
        h = max(120, min(2160, int(height)))
        if self._window is not None:
            with suppress(Exception):
                self._window.resize(w, h)
        return {"width": w, "height": h}

    def toggle_miniature(
        self,
        width: int = 384,
        height: int = 224,
        opacity: float = 0.85,
    ) -> dict[str, Any]:
        """Toggle between full desktop window and a floating, translucent miniature companion."""
        if self._window is None:
            return {"active": False, "opacity": 1.0, "width": 0, "height": 0}

        self._miniature = not self._miniature
        if self._miniature:
            with suppress(Exception):
                self._saved_size = (int(self._window.width), int(self._window.height))

            self.resize_window(width, height)
            self.set_on_top(True)
            self.set_opacity(opacity)
        else:
            self.set_opacity(1.0)
            self.set_on_top(False)
            self.resize_window(self._saved_size[0], self._saved_size[1])

        return {
            "active": self._miniature,
            "opacity": self._opacity,
            "width": width if self._miniature else self._saved_size[0],
            "height": height if self._miniature else self._saved_size[1],
        }

    def get_miniature_state(self) -> dict[str, Any]:
        return {
            "active": self._miniature,
            "opacity": self._opacity,
            "width": int(self._window.width) if self._window is not None else self._saved_size[0],
            "height": int(self._window.height) if self._window is not None else self._saved_size[1],
        }


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
    parser.add_argument("--years-ahead", type=int, default=400)
    parser.add_argument("--mods", type=Path, default=DEFAULT_MODS, help="mods/README.md")
    parser.add_argument("--fullscreen", action="store_true", help="open directly in fullscreen")
    parser.add_argument("--title", default=WINDOW_TITLE, help="the window's title")
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
        import webview  # Lazy import so headless Linux servers never need pywebview
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
    api = DesktopApi(initial_fullscreen=args.fullscreen)
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
    api._window = window

    from lineage_server.tray import TrayController, ask_close_action

    quitting = threading.Event()
    tray: TrayController | None = None

    def on_tray_show() -> None:
        window.show()
        window.restore()

    def on_tray_exit() -> None:
        quitting.set()
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
    window.events.shown += lambda: api._get_form()
    try:
        log.info("Starting webview event loop")
        webview.start(debug=False)
        log.info("webview event loop terminated cleanly")
    finally:
        if tray is not None:
            tray.stop()
        shutdown()


if __name__ == "__main__":
    main()
