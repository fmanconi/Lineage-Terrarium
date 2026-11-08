"""Run the island in real time (S1, ADR 0023).

Usage::

    uv run python -m lineage_server.main --data DIR [--dist renderer/dist-kiosk]
        [--fake-device [--absent]] [--settings server/config/server.toml]
        [--config sim/config/default.toml] [--seed N]

Opens the newest save under ``DIR/saves`` (or makes world 1, from ``--seed`` or a random
one), lives the time the device was off with the owner away, then follows the wall clock,
serving the kiosk's pages from ``--dist``, the state stream at ``/stream`` and its numbers
at ``/status``. SIGTERM or Ctrl+C saves and stops.

The device: ``--fake-device`` takes presence and the buttons as keys typed on standard
input (``lineage_device.fake``; ``--absent`` starts with the owner away). The real device
comes with S2.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import datetime as dt
import logging
import signal
import sys
from dataclasses import replace
from pathlib import Path

from lineage_device.fake import FakeDevice, KeyboardDevice
from lineage_sim.config import parse_config

from lineage_server.island import Island, new_seed
from lineage_server.server import ScaledClock, Server, SystemClock
from lineage_server.settings import DEFAULT_SETTINGS, load_settings
from lineage_server.store import Store

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "sim" / "config" / "default.toml"
FAST_LIFE_CONFIG = Path(__file__).resolve().parents[2] / "sim" / "config" / "fast_life.toml"
FAST_LIFE_TIME_SCALE = 90.0
DEFAULT_MODS = Path(__file__).resolve().parents[2] / "mods"


def _years_ahead_offset_ms(years_ahead: int) -> int:
    """Exact UTC millisecond offset shifting today's calendar year forward by ``years_ahead``
    while preserving time-of-day and day/month (+400y = exact 146,097-day Gregorian cycle)."""
    if years_ahead == 0:
        return 0
    base = dt.datetime(2026, 6, 15, 12, 0, 0, tzinfo=dt.UTC)
    shifted = base.replace(year=base.year + years_ahead)
    return round((shifted - base).total_seconds() * 1000)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the Lineage island in real time.")
    parser.add_argument("--data", type=Path, required=True, help="saves and archives live here")
    parser.add_argument("--dist", type=Path, help="the renderer's build to serve (dist-kiosk)")
    parser.add_argument("--mods", type=Path, default=DEFAULT_MODS, help="mods/README.md")
    parser.add_argument("--settings", type=Path, default=DEFAULT_SETTINGS)
    parser.add_argument("--config", type=Path, default=None, help="the sim's config")
    parser.add_argument("--seed", type=int, help="the first world's seed (default: random)")
    parser.add_argument("--fake-device", action="store_true", help="keys on stdin (S1)")
    parser.add_argument(
        "--headless", action="store_true", help="run headless daemon without keyboard input"
    )
    parser.add_argument(
        "--solar", action="store_true", help="enable real sun solar cycle (Europe/Rome)"
    )
    parser.add_argument(
        "--fast-life",
        action="store_true",
        help="run 90x insect-speed biological lifecycle with 60+-10 min day/night cycle",
    )
    parser.add_argument(
        "--time-scale",
        type=float,
        default=None,
        help="sim seconds per real second (default: 90 with --fast-life, else 1.0)",
    )
    parser.add_argument(
        "--pause-offline",
        action="store_true",
        help="resume loaded saves where they stopped without simulating offline downtime",
    )
    parser.add_argument(
        "--port", type=int, help="override HTTP/WebSocket listen port from server.toml"
    )
    parser.add_argument(
        "--years-ahead",
        type=int,
        default=0,
        help="run the live wall clock shifted N Gregorian years into the future (e.g. 400)",
    )
    parser.add_argument("--absent", action="store_true", help="the fake starts with no owner")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # Every page and socket opened is logged by websockets at INFO: too much for a journal.
    logging.getLogger("websockets").setLevel(logging.WARNING)
    if args.dist is not None and not (args.dist / "index.html").is_file():
        parser.error(f"{args.dist} holds no index.html (cd renderer && npm run build:kiosk)")
    config_path = args.config or (FAST_LIFE_CONFIG if args.fast_life else DEFAULT_CONFIG)
    time_scale = (
        args.time_scale
        if args.time_scale is not None
        else (FAST_LIFE_TIME_SCALE if args.fast_life else 1.0)
    )
    pause_offline = bool(args.pause_offline or args.fast_life)
    settings = load_settings(args.settings)
    if args.port is not None:
        settings = replace(settings, port=args.port)
    if time_scale > 1.0:
        settings = replace(
            settings,
            poll_seconds=min(settings.poll_seconds, 0.25),
            jump_seconds=settings.jump_seconds * time_scale,
        )
    config = parse_config(config_path.read_text(encoding="utf-8"))
    if args.solar and not config.presence.alternating_cycle:
        config = replace(config, presence=replace(config.presence, solar_cycle=True))
    seed = args.seed
    island = Island(
        config,
        Store(args.data),
        settings,
        seed=new_seed if seed is None else (lambda: seed),
        pause_offline=pause_offline,
        time_scale=time_scale,
    )
    if args.headless or not sys.stdin.isatty():
        device = FakeDevice(present=not args.absent)
    else:
        device = KeyboardDevice(present=not args.absent)
    base_now_ms = SystemClock(_years_ahead_offset_ms(args.years_ahead)).now_ms()
    wall_clock = (
        ScaledClock(scale=time_scale, initial_unix_ms=base_now_ms)
        if time_scale != 1.0
        else SystemClock(_years_ahead_offset_ms(args.years_ahead))
    )
    server = Server(island, device, settings, dist=args.dist, clock=wall_clock, mods=args.mods)

    async def run() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(signum, stop.set)
        await server.run(stop)

    asyncio.run(run())
    print("saved; stopped", file=sys.stderr)


if __name__ == "__main__":
    main()
