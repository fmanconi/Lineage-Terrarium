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
from lineage_server.server import Server, SystemClock
from lineage_server.settings import DEFAULT_SETTINGS, load_settings
from lineage_server.store import Store

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "sim" / "config" / "default.toml"


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
    parser.add_argument("--settings", type=Path, default=DEFAULT_SETTINGS)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="the sim's config")
    parser.add_argument("--seed", type=int, help="the first world's seed (default: random)")
    parser.add_argument("--fake-device", action="store_true", help="keys on stdin (S1)")
    parser.add_argument(
        "--headless", action="store_true", help="run headless daemon without keyboard input"
    )
    parser.add_argument(
        "--solar", action="store_true", help="enable real sun solar cycle (Europe/Rome)"
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
    settings = load_settings(args.settings)
    if args.port is not None:
        settings = replace(settings, port=args.port)
    config = parse_config(args.config.read_text(encoding="utf-8"))
    if args.solar:
        config = replace(config, presence=replace(config.presence, solar_cycle=True))
    seed = args.seed
    island = Island(
        config, Store(args.data), settings, seed=new_seed if seed is None else (lambda: seed)
    )
    if args.headless or not sys.stdin.isatty():
        device = FakeDevice(present=not args.absent)
    else:
        device = KeyboardDevice(present=not args.absent)
    wall_clock = SystemClock(_years_ahead_offset_ms(args.years_ahead))
    server = Server(island, device, settings, dist=args.dist, clock=wall_clock)

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
