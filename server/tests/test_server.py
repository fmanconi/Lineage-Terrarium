"""The server end to end (S1): the island, the fake device and real WebSocket and HTTP
clients, on a clock the test moves by hand."""

from __future__ import annotations

import asyncio
import dataclasses
import importlib.util
import json
import shutil
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from lineage_device.fake import FakeDevice
from lineage_device.interface import Presence, ViewPressed
from lineage_server.island import Island
from lineage_server.protocol import SCHEMA_PATH
from lineage_server.server import Server
from lineage_server.settings import DEFAULT_SETTINGS, load_settings
from lineage_server.store import Store
from lineage_sim.config import parse_config
from lineage_sim.state import io
from lineage_sim.world import World
from websockets.asyncio.client import ClientConnection, connect

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
CONFIG = parse_config((REPO / "sim" / "config" / "default.toml").read_text("utf-8"))
SETTINGS = dataclasses.replace(
    load_settings(DEFAULT_SETTINGS), host="127.0.0.1", port=0, poll_seconds=0.01
)
SCHEMA = json.loads(SCHEMA_PATH.read_text("utf-8"))
MINUTE = 60_000
WAIT_S = 30


def _schema_errors() -> Callable[[Any, dict[str, Any]], list[str]]:
    """The protocol tests' schema checker."""
    spec = importlib.util.spec_from_file_location(
        "protocol_tests", Path(__file__).with_name("test_protocol.py")
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.errors


errors = _schema_errors()


class HandClock:
    def __init__(self, now_ms: int) -> None:
        self.now = now_ms

    def now_ms(self) -> int:
        return self.now


async def _next(client: ClientConnection, kind: str) -> list[dict[str, Any]]:
    """Messages received up to and including the next of type ``kind``."""
    got: list[dict[str, Any]] = []
    async with asyncio.timeout(WAIT_S):
        while True:
            message = json.loads(await client.recv())
            assert errors(message, SCHEMA) == [], message["type"]
            got.append(message)
            if message["type"] == kind:
                return got


async def _get(url: str, method: str = "GET") -> tuple[int, bytes]:
    def fetch() -> tuple[int, bytes]:
        req = urllib.request.Request(url, method=method)
        try:
            with urllib.request.urlopen(req, timeout=WAIT_S) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    return await asyncio.to_thread(fetch)


def _serve(
    tmp_path: Path,
    test: Callable[[Server, HandClock, FakeDevice], Awaitable[None]],
    mods: Path | None = None,
) -> Server:
    store = Store(tmp_path / "data")
    if not store.saves():
        shutil.copy(SAVE, store.saves_dir / "2026-01-01T00-00-00.000Z.lzma")
    start = World.restore(CONFIG, io.loads(SAVE.read_bytes())).unix_ms
    clock = HandClock(start)
    device = FakeDevice(present=False)
    dist = tmp_path / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "index.html").write_text("<p>the desk</p>")
    (tmp_path / "secret.txt").write_text("no")
    island = Island(CONFIG, store, SETTINGS)
    server = Server(
        island,
        device,
        SETTINGS,
        dist=dist,
        clock=clock,
        is_desk=lambda connection: "phone" not in connection.request.path,  # type: ignore[union-attr]
        mods=mods,
    )

    async def run() -> None:
        stop = asyncio.Event()
        ready = asyncio.Event()
        serving = asyncio.create_task(server.run(stop, ready.set))
        async with asyncio.timeout(WAIT_S):
            await ready.wait()
        try:
            await test(server, clock, device)
        finally:
            stop.set()
            await serving

    asyncio.run(run())
    return server


def test_clients_get_the_world_then_its_life_and_the_desk_its_button(tmp_path: Path) -> None:
    async def test(server: Server, clock: HandClock, device: FakeDevice) -> None:
        url = f"ws://127.0.0.1:{server.port}/stream"
        async with connect(url) as desk, connect(url + "?phone") as phone:
            for client in (desk, phone):
                opening = [m["type"] for m in await _next(client, "creatures")]
                assert opening[:4] == ["clock", "sky", "land", "fauna"]
            # Ten minutes on: the creatures move, the light is told.
            clock.now += 10 * MINUTE
            for client in (desk, phone):
                types = [m["type"] for m in await _next(client, "sky")]
                assert "creatures" in types
            # The owner arrives; the view button is the desk's alone.
            device.push(Presence(True))
            device.push(ViewPressed())
            clock.now += MINUTE
            skies = [m for m in await _next(desk, "view") if m["type"] == "sky"]
            assert skies[-1]["present"] is True
            for message in await _next(phone, "sky"):
                assert message["type"] != "view"
            clock.now += 10 * MINUTE
            for message in await _next(phone, "creatures"):
                assert message["type"] != "view"
            assert server.clients == 2

    server = _serve(tmp_path, test)
    assert isinstance(server.device, FakeDevice)
    # The LED was set from the start and says what the island says.
    assert server.device.led_changes
    assert server.device.led is server.island.cooling_down


def test_the_pages_and_the_status_are_served(tmp_path: Path) -> None:
    async def test(server: Server, clock: HandClock, device: FakeDevice) -> None:
        base = f"http://127.0.0.1:{server.port}"
        assert await _get(base + "/") == (200, b"<p>the desk</p>")
        assert (await _get(base + "/index.html"))[0] == 200
        assert (await _get(base + "/../secret.txt"))[0] == 404
        assert (await _get(base + "/%2e%2e/secret.txt"))[0] == 404
        assert (await _get(base + "/nothing.js"))[0] == 404
        code, body = await _get(base + "/status")
        status = json.loads(body)
        assert code == 200
        assert status["ready"] is True
        assert status["world"] == 1
        assert status["sim_cpu_s"] >= 0

    _serve(tmp_path, test)


def test_user_mods_are_listed_and_served(tmp_path: Path) -> None:
    mods = tmp_path / "mods"
    shutil.copytree(REPO / "mods" / "client" / "sample-banner", mods / "client" / "sample-banner")
    (mods / "client" / "not-a-mod").mkdir()  # no mod.json: never listed
    (mods / "client" / "secret.txt").write_text("no")
    (mods / "sim" / "rainmaker").mkdir(parents=True)
    (mods / "sim" / "rainmaker" / "mod.json").write_text(json.dumps({"id": "rainmaker"}))

    async def test(server: Server, clock: HandClock, device: FakeDevice) -> None:
        base = f"http://127.0.0.1:{server.port}"
        code, body = await _get(base + "/api/mods")
        assert code == 200
        listed = {mod["id"]: mod for mod in json.loads(body)}
        assert sorted(listed) == ["rainmaker", "sample-banner"]
        banner = listed["sample-banner"]
        assert banner["kind"] == "client"
        assert banner["name"] == "Sample Banner"
        assert banner["defaultEnabled"] is False
        assert banner["entry"] == "/user-mods/sample-banner/index.js"
        assert listed["rainmaker"]["kind"] == "sim"
        assert "entry" not in listed["rainmaker"]

        def fetch() -> tuple[int, str, bytes]:
            with urllib.request.urlopen(base + banner["entry"], timeout=WAIT_S) as response:
                return response.status, response.headers["Content-Type"], response.read()

        code, kind, script = await asyncio.to_thread(fetch)
        assert (code, kind) == (200, "text/javascript")
        assert b"export default class SampleBannerMod" in script
        assert (await _get(base + "/user-mods/sample-banner/mod.json"))[0] == 200
        for path in (
            "/user-mods/sample-banner/../../secret.txt",
            "/user-mods/sample-banner/../secret.txt",
            "/user-mods/sample-banner/%2e%2e/%2e%2e/secret.txt",
            "/user-mods/../secret.txt",
            "/user-mods/..%2fsecret.txt",
            "/user-mods/Sample-Banner/index.js",
            "/user-mods/sample%20banner/index.js",
            "/user-mods/.hidden/index.js",
            "/user-mods/sample-banner/",
            "/user-mods/sample-banner",
            "/user-mods/sample-banner/nothing.js",
            "/user-mods/rainmaker/mod.json",
        ):
            assert (await _get(base + path))[0] == 404, path

    _serve(tmp_path, test, mods=mods)


def test_stopping_saves_and_a_restart_goes_on_from_there(tmp_path: Path) -> None:
    async def first(server: Server, clock: HandClock, device: FakeDevice) -> None:
        async with connect(f"ws://127.0.0.1:{server.port}/stream") as client:
            await _next(client, "creatures")
            clock.now += 30 * MINUTE + 1234
            await _next(client, "sky")

    server = _serve(tmp_path, first)
    saved = io.loads(Store(tmp_path / "data").saves()[-1].read_bytes())
    assert saved.t_ms == server.island.world.t_ms
    assert io.state_hash(saved) == server.island.world.state_hash()

    async def second(server: Server, clock: HandClock, device: FakeDevice) -> None:
        async with connect(f"ws://127.0.0.1:{server.port}/stream") as client:
            clocks = [m for m in await _next(client, "creatures") if m["type"] == "clock"]
            assert clocks[0]["t_ms"] >= saved.t_ms

    _serve(tmp_path, second)


@pytest.mark.parametrize("path", ["/stream", "/stream?phone"])
def test_a_client_that_goes_is_forgotten(tmp_path: Path, path: str) -> None:
    async def test(server: Server, clock: HandClock, device: FakeDevice) -> None:
        async with connect(f"ws://127.0.0.1:{server.port}{path}") as client:
            await _next(client, "creatures")
        clock.now += 10 * MINUTE
        async with asyncio.timeout(WAIT_S):
            while server.clients:
                await asyncio.sleep(0.01)

    _serve(tmp_path, test)


def test_god_power_http_status_invoke_cooldown_and_desk_only(tmp_path: Path) -> None:
    async def test(server: Server, clock: HandClock, device: FakeDevice) -> None:
        base = f"http://127.0.0.1:{server.port}"
        async with connect(f"ws://127.0.0.1:{server.port}/stream") as desk:
            await _next(desk, "creatures")
            code, body = await _get(base + "/god-power")
            assert code == 200
            initial = json.loads(body)
            assert set(initial["needs"].keys()) == {"rain", "seed", "ark"}

            # Phone cannot invoke the weekly miracle.
            code, _ = await _get(base + "/god-power?phone", method="POST")
            assert code == 403

            # If the fixture save is currently cooling down, fast-forward the hand clock past it.
            if not initial["ready"]:
                assert initial["remaining_ms"] > 0
                clock.now += int(initial["remaining_ms"]) + MINUTE
                await _next(desk, "sky")
                code, body = await _get(base + "/god-power")
                assert code == 200
                ready_now = json.loads(body)
                assert ready_now["ready"] is True
                assert ready_now["remaining_ms"] == 0

            # Desk invokes the weekly miracle; stream receives god_power event and cooldown starts.
            code, body = await _get(base + "/god-power", method="POST")
            assert code == 200
            fired = json.loads(body)
            assert fired["invoked"] is True
            assert fired["power"] in {"meteor", "rain", "seed", "ark"}
            assert fired["ready"] is False
            assert fired["remaining_ms"] > 0

            events_msgs = await _next(desk, "events")
            assert any(
                ev.get("kind") == "god_power"
                for m in events_msgs
                if m["type"] == "events"
                for ev in m["events"]
            )

            # Second invocation during cooldown is refused with 409.
            code, body = await _get(base + "/god-power", method="POST")
            assert code == 409
            refused = json.loads(body)
            assert refused["invoked"] is False
            assert refused["ready"] is False

    _serve(tmp_path, test)
