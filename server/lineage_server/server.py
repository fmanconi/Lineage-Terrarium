"""The server's event loop (S1, ADR 0023): the island in real time, its stream, its pages.

One port serves the kiosk's pages (the renderer's build, ``--dist``), the state stream as
a WebSocket at ``/stream``, and the server's own numbers at ``/status``. The user's mods
(``mods/``, ``mods/README.md``) are listed at ``/api/mods`` and the client mods' files
served under ``/user-mods/<id>/``.

Every call on the island runs in one sim thread, and its messages are handed to the
clients under one lock, so every client sees the messages in the order they were made: a
client that connects gets everything as it is now, then whatever comes after. Each client
has its own queue, written to its socket by a task of its own; a client that falls too far
behind (``client_backlog`` batches) is let go and reconnects (the renderer tries again).

The desk is the client on the device itself (a loopback address): only it is told of the
view button. Phones are never on the loopback.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import mimetypes
import os
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Any, Protocol, TypeVar

from lineage_device.interface import Device, GodPowerPressed
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from lineage_server.island import Island
from lineage_server.protocol.encode import Message
from lineage_server.settings import Settings

log = logging.getLogger(__name__)

STREAM_PATH = "/stream"
STATUS_PATH = "/status"
GOD_POWER_PATH = "/god-power"
MODS_PATH = "/api/mods"
USER_MODS_PREFIX = "/user-mods/"
MOD_KINDS = ("client", "sim")
MOD_ID = re.compile(r"[a-z0-9][a-z0-9_-]*")
_T = TypeVar("_T")


class WallClock(Protocol):
    """Where the server reads the time: the system's on the device, a test's by hand."""

    def now_ms(self) -> int: ...


class SystemClock:
    def __init__(self, offset_ms: int = 0) -> None:
        self._offset_ms = int(offset_ms)

    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000 + self._offset_ms


class ScaledClock:
    """Wall clock whose time flows ``scale`` times faster than real time from an anchor."""

    def __init__(self, scale: float = 1.0, initial_unix_ms: int | None = None) -> None:
        if scale <= 0:
            raise ValueError("scale must be positive")
        self.scale = float(scale)
        self._anchor_mono_ns = time.monotonic_ns()
        self._anchor_unix_ms = (
            int(initial_unix_ms) if initial_unix_ms is not None else time.time_ns() // 1_000_000
        )

    def anchor_to(self, sim_unix_ms: int) -> None:
        """Anchor the scaled clock to ``sim_unix_ms`` right now (zero offline jump)."""
        self._anchor_mono_ns = time.monotonic_ns()
        self._anchor_unix_ms = int(sim_unix_ms)

    def now_ms(self) -> int:
        elapsed_ms = ((time.monotonic_ns() - self._anchor_mono_ns) * self.scale) / 1_000_000.0
        return self._anchor_unix_ms + round(elapsed_ms)


def is_loopback(connection: ServerConnection) -> bool:
    """Whether the client is on the device itself (the desk's kiosk)."""
    address = connection.remote_address
    if not address:
        return False
    try:
        return ipaddress.ip_address(str(address[0])).is_loopback
    except ValueError:
        return False


def is_local_network(connection: ServerConnection) -> bool:
    """Whether the client is on loopback, private home LAN, or Tailscale CGNAT."""
    address = connection.remote_address
    if not address:
        return False
    try:
        return not ipaddress.ip_address(str(address[0])).is_global
    except ValueError:
        return False


@dataclass
class _Client:
    connection: ServerConnection
    desk: bool
    queue: asyncio.Queue[list[str]]


def _encode(messages: list[Message]) -> list[str]:
    return [json.dumps(message, separators=(",", ":")) for message in messages]


class Server:
    def __init__(
        self,
        island: Island,
        device: Device,
        settings: Settings,
        dist: Path | None = None,
        clock: WallClock | None = None,
        is_desk: Callable[[ServerConnection], bool] = is_loopback,
        mods: Path | None = None,
    ) -> None:
        self.island = island
        self.device = device
        self.settings = settings
        self.dist = dist.resolve() if dist is not None else None
        self.mods = mods.resolve() if mods is not None else None
        self.clock = clock if clock is not None else SystemClock()
        self.is_desk = is_desk
        self.port: int | None = None
        self._sim = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sim")
        self._lock = asyncio.Lock()
        self._clients: list[_Client] = []
        self._ready = asyncio.Event()
        self._started_wall = time.monotonic()
        self._closing: set[asyncio.Task[None]] = set()

    async def _in_sim(self, work: Callable[[], _T]) -> _T:
        return await asyncio.get_running_loop().run_in_executor(self._sim, work)

    def _hand(self, everyone: list[str], desk: list[str] | None = None) -> None:
        """Queue messages for the clients (under the lock, in the order made)."""
        for client in list(self._clients):
            batch = everyone + desk if client.desk and desk else everyone
            if not batch:
                continue
            if client.queue.qsize() >= self.settings.client_backlog:
                log.warning("a client fell behind; letting it go")
                self._clients.remove(client)
                closing = asyncio.create_task(client.connection.close())
                self._closing.add(closing)
                closing.add_done_callback(self._closing.discard)
                continue
            client.queue.put_nowait(batch)

    # --- The island in time ---------------------------------------------------------------

    async def _live(self) -> None:
        """Bring the island to the wall clock, again and again."""
        while True:
            await asyncio.sleep(self.settings.poll_seconds)
            async with self._lock:
                now = self.clock.now_ms()
                messages = await self._in_sim(lambda now=now: _encode(self.island.advance(now)))
                self._hand(messages)
                self._led()

    async def _listen(self) -> None:
        """What the device says, as it says it."""
        while True:
            event = await self.device.next_event()
            async with self._lock:
                now = self.clock.now_ms()

                def handle(event: Any = event, now: int = now) -> tuple[list[str], list[str]]:
                    reply = self.island.handle(event, now)
                    return _encode(reply.everyone), _encode(reply.desk)

                everyone, desk = await self._in_sim(handle)
                self._hand(everyone, desk)
                self._led()

    def _led(self) -> None:
        self.device.set_cooldown_led(self.island.cooling_down)

    # --- Clients --------------------------------------------------------------------------

    async def _client(self, connection: ServerConnection) -> None:
        await self._ready.wait()
        client = _Client(connection, self.is_desk(connection), asyncio.Queue())
        async with self._lock:
            opening = await self._in_sim(lambda: _encode(self.island.connect()))
            client.queue.put_nowait(opening)
            self._clients.append(client)
        log.info("client %s connected%s", connection.remote_address, " (desk)" * client.desk)
        # The socket closing (the client gone, or let go) ends the wait for messages too.
        closed = asyncio.create_task(connection.wait_closed())
        try:
            while True:
                batch = asyncio.create_task(client.queue.get())
                await asyncio.wait({batch, closed}, return_when=asyncio.FIRST_COMPLETED)
                if not batch.done():
                    batch.cancel()
                    break
                for text in batch.result():
                    await connection.send(text)
        except ConnectionClosed:
            pass
        finally:
            closed.cancel()
            if client in self._clients:
                self._clients.remove(client)
            log.info("client %s gone", connection.remote_address)

    @property
    def clients(self) -> int:
        return len(self._clients)

    # --- Pages ----------------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        """The server's numbers (S1/S7): what the sim costs, saves, memory."""
        numbers = self.island.numbers
        wall = time.monotonic() - self._started_wall
        world = self.island.world if self._ready.is_set() else None
        return {
            "ready": self._ready.is_set(),
            "world": None if world is None else world.number,
            "seed": None if world is None else world.seed,
            "date": None if world is None else world.instant.date.isoformat(),
            "clients": self.clients,
            "wall_s": round(wall, 1),
            "sim_cpu_s": round(numbers.sim_cpu_s, 3),
            "sim_core_share": round(numbers.sim_cpu_s / wall, 4) if wall > 0 else 0.0,
            "caught_up_days": round(numbers.caught_up_days, 3),
            "catch_up_cpu_s": round(numbers.catch_up_cpu_s, 3),
            "catch_up_s_per_day": (
                round(numbers.catch_up_cpu_s / numbers.caught_up_days, 3)
                if numbers.caught_up_days > 0
                else None
            ),
            "saves": numbers.saves,
            "last_save_s": round(numbers.last_save_s, 3),
            "longest_save_s": round(numbers.longest_save_s, 3),
            "rss_mb": _rss_mb(),
        }

    async def _http(self, connection: ServerConnection, request: Request) -> Response | None:
        path = request.path.split("?", 1)[0]
        if path == STREAM_PATH:
            return None
        if path == STATUS_PATH:
            body = json.dumps(self.status()).encode()
            return _response(HTTPStatus.OK, body, "application/json")
        if path == GOD_POWER_PATH:
            return await self._god_power_http(connection, request)
        if path == MODS_PATH:
            body = json.dumps(self.list_mods()).encode()
            return _response(HTTPStatus.OK, body, "application/json")
        if path.startswith(USER_MODS_PREFIX):
            return self._mod_file(path.removeprefix(USER_MODS_PREFIX))
        return self._file(path)

    async def _god_power_http(self, connection: ServerConnection, request: Request) -> Response:
        if not self._ready.is_set():
            return _response(HTTPStatus.SERVICE_UNAVAILABLE, b'{"ready":false}', "application/json")
        method = getattr(request, "method", "GET").upper()
        if method == "OPTIONS":
            return _response(HTTPStatus.NO_CONTENT, b"", "text/plain")
        if method == "GET":
            async with self._lock:
                data = await self._in_sim(self.island.miracle_status)
            return _response(HTTPStatus.OK, json.dumps(data).encode(), "application/json")
        if method == "POST":
            allowed = self.is_desk(connection) or (
                self.is_desk is is_loopback and is_local_network(connection)
            )
            if not allowed:
                return _response(HTTPStatus.FORBIDDEN, b'{"error":"desk_only"}', "application/json")
            async with self._lock:
                now = self.clock.now_ms()

                def invoke(
                    now: int = now,
                ) -> tuple[list[str], list[str], str | None, dict[str, Any]]:
                    reply = self.island.handle(GodPowerPressed(), now)
                    power_used: str | None = None
                    for msg in reply.everyone:
                        if msg.get("type") == "events":
                            for ev in msg.get("events", []):
                                if ev.get("kind") == "god_power":
                                    power_used = str(ev.get("power"))
                    return (
                        _encode(reply.everyone),
                        _encode(reply.desk),
                        power_used,
                        self.island.miracle_status(),
                    )

                everyone, desk, power_used, status_data = await self._in_sim(invoke)
                self._hand(everyone, desk)
                self._led()
            payload = {"invoked": power_used is not None, "power": power_used, **status_data}
            code = HTTPStatus.OK if power_used is not None else HTTPStatus.CONFLICT
            return _response(code, json.dumps(payload).encode(), "application/json")
        return _response(
            HTTPStatus.METHOD_NOT_ALLOWED, b'{"error":"method_not_allowed"}', "application/json"
        )

    def _file(self, path: str) -> Response:
        if self.dist is None:
            return _response(HTTPStatus.NOT_FOUND, b"no pages here\n", "text/plain")
        relative = path.lstrip("/") or "index.html"
        target = (self.dist / relative).resolve()
        if target.is_dir():
            target = target / "index.html"
        if not target.is_relative_to(self.dist) or not target.is_file():
            return _response(HTTPStatus.NOT_FOUND, b"not found\n", "text/plain")
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return _response(HTTPStatus.OK, target.read_bytes(), kind)

    # --- User mods ------------------------------------------------------------------------

    def list_mods(self) -> list[dict[str, Any]]:
        """Every mod under ``mods/client`` and ``mods/sim`` with a valid ``mod.json``."""
        return [] if self.mods is None else find_mods(self.mods)

    def _mod_file(self, rest: str) -> Response:
        """A file of ``mods/client/<id>/``, never one outside it."""
        missing = _response(HTTPStatus.NOT_FOUND, b"not found\n", "text/plain")
        if self.mods is None:
            return missing
        mod_id, _, relative = rest.partition("/")
        if not MOD_ID.fullmatch(mod_id) or not relative:
            return missing
        root = (self.mods / "client" / mod_id).resolve()
        target = (root / relative).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            return missing
        if target.suffix in (".js", ".mjs"):
            # Module scripts need a JavaScript type, which the system's tables may not give.
            kind = "text/javascript"
        else:
            kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return _response(HTTPStatus.OK, target.read_bytes(), kind)

    # --- Running --------------------------------------------------------------------------

    async def run(self, stop: asyncio.Event, ready: Callable[[], None] = lambda: None) -> None:
        """Open the island, serve until ``stop`` is set, then save and close."""
        settings = self.settings
        async with serve(
            self._client, settings.host, settings.port, process_request=self._http
        ) as server:
            self.port = next(iter(server.sockets)).getsockname()[1]
            log.info("serving on port %d", self.port)
            opened = await self._in_sim(lambda: self.island.open(self.clock.now_ms()))
            if isinstance(self.clock, ScaledClock) and self.island.pause_offline:
                self.clock.anchor_to(self.island.world.unix_ms)
            if opened.skipped:
                log.warning("saves that did not load: %s", [p.name for p in opened.skipped])
            self._started_wall = time.monotonic()
            self.island.numbers.sim_cpu_s = 0.0
            self._led()
            self._ready.set()
            ready()
            tasks = [
                asyncio.create_task(self._live()),
                asyncio.create_task(self._listen()),
                asyncio.create_task(self._log()),
            ]
            try:
                await stop.wait()
            finally:
                for task in tasks:
                    task.cancel()
                for task in tasks:
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                async with self._lock:
                    await self._in_sim(self.island.save)
                for client in list(self._clients):
                    await client.connection.close()
        self.device.close()
        self._sim.shutdown()

    async def _log(self) -> None:
        while True:
            await asyncio.sleep(self.settings.log_every_seconds)
            log.info("status %s", json.dumps(self.status()))


def find_mods(root: Path) -> list[dict[str, Any]]:
    """Every mod under ``root/client`` and ``root/sim`` with a valid ``mod.json``: its
    metadata, its ``kind`` and, for a client mod, the URL of its entry."""
    found: list[dict[str, Any]] = []
    for kind in MOD_KINDS:
        folder = root / kind
        if not folder.is_dir():
            continue
        for mod_dir in sorted(folder.iterdir(), key=lambda p: p.name):
            meta = _read_mod_json(mod_dir)
            if meta is None:
                continue
            listed = {**meta, "kind": kind}
            if kind == "client":
                entry = meta.get("entry", "index.js")
                listed["entry"] = f"{USER_MODS_PREFIX}{mod_dir.name}/{entry}"
            found.append(listed)
    return found


def _read_mod_json(mod_dir: Path) -> dict[str, Any] | None:
    """A mod's ``mod.json`` if its folder is a mod: a valid id equal to the folder's name."""
    if not mod_dir.is_dir() or not MOD_ID.fullmatch(mod_dir.name):
        return None
    try:
        meta: object = json.loads((mod_dir / "mod.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.warning("mod %s has no readable mod.json", mod_dir.name)
        return None
    if not isinstance(meta, dict) or meta.get("id") != mod_dir.name:  # type: ignore[union-attr]
        log.warning("mod %s: mod.json's id is not the folder's name", mod_dir.name)
        return None
    checked: dict[str, Any] = dict(meta)  # type: ignore[arg-type]
    entry = checked.get("entry", "index.js")
    if not isinstance(entry, str) or entry.startswith("/") or ".." in entry.split("/"):
        log.warning("mod %s: bad entry %r", mod_dir.name, entry)
        return None
    return checked


def _response(status: HTTPStatus, body: bytes, kind: str) -> Response:
    headers = Headers([("Content-Type", kind), ("Content-Length", str(len(body)))])
    headers["Cache-Control"] = "no-cache"
    headers["Access-Control-Allow-Origin"] = "*"
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return Response(status.value, status.phrase, headers, body)


def _rss_mb() -> float | None:
    """The process's resident memory now, in MB (Linux), or None."""
    try:
        pages = int(Path("/proc/self/statm").read_text().split()[1])
    except (OSError, IndexError, ValueError):
        return None
    return round(pages * os.sysconf("SC_PAGE_SIZE") / 1e6, 1)
