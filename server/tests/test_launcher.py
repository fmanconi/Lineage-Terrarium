"""The launcher: its worlds, mods, the game's command line and the browser's bridge."""

from __future__ import annotations

import datetime as dt
import json
import shutil
import sys
import threading
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from lineage_server.launcher import (
    DAY_MINUTES,
    DEFAULT_DAY_MINUTES,
    LAUNCHER_PAGE,
    MODES,
    SPEEDS,
    TOKEN_HEADER,
    LauncherApi,
    bridge_server,
    creature_count,
)

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
TODAY = dt.date(2026, 11, 8)


class Spawned:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self.launched = threading.Event()

    def __call__(self, command: Sequence[str]) -> int:
        self.commands.append(list(command))
        return 4242


def _api(tmp_path: Path, spawned: Spawned | None = None) -> LauncherApi:
    data = tmp_path / "data"
    (data / "island" / "saves").mkdir(parents=True)
    shutil.copy(SAVE, data / "island" / "saves" / "2426-11-17T00-00-06.529Z.lzma")
    (data / "island" / "archives").mkdir()
    (data / "island" / "archives" / "world-001-seed-7.lzma").write_bytes(b"")
    (data / "fresh" / "saves").mkdir(parents=True)  # a world with no save yet
    (data / "not-a-world").mkdir()  # no saves/
    (data / "desktop.log").write_text("")
    mods = tmp_path / "mods"
    shutil.copytree(REPO / "mods" / "client" / "sample-banner", mods / "client" / "sample-banner")
    (mods / "sim" / "rainmaker").mkdir(parents=True)
    (mods / "sim" / "rainmaker" / "mod.json").write_text(json.dumps({"id": "rainmaker"}))
    spawned = spawned if spawned is not None else Spawned()
    return LauncherApi(
        data, mods, spawn=spawned, on_launched=spawned.launched.set, today=lambda: TODAY
    )


def test_worlds_are_the_data_folders_with_saves(tmp_path: Path) -> None:
    worlds = {w["name"]: w for w in _api(tmp_path).list_worlds()}
    assert sorted(worlds) == ["fresh", "island"]
    island = worlds["island"]
    assert island["creatures"] == creature_count(SAVE)
    assert island["creatures"] is not None
    assert island["creatures"] > 0
    assert island["island_time"].startswith("2426-11-17T00:00:06")
    assert island["saved_at"] is not None
    assert (island["saves"], island["ended_worlds"]) == (1, 1)
    assert worlds["fresh"]["creatures"] is None
    assert worlds["fresh"]["saved_at"] is None


def test_an_unreadable_save_has_no_creature_count(tmp_path: Path) -> None:
    broken = tmp_path / "2026-01-01T00-00-00.000Z.lzma"
    broken.write_bytes(b"not a save")
    assert creature_count(broken) is None


def test_mods_are_listed_and_client_mods_switched_in_their_mod_json(tmp_path: Path) -> None:
    api = _api(tmp_path)
    mods = {m["id"]: m for m in api.list_mods()}
    assert mods["sample-banner"]["enabled"] is True
    assert mods["sample-banner"]["kind"] == "client"
    assert mods["rainmaker"]["kind"] == "sim"

    assert api.set_mod_enabled("sample-banner", False) == {
        "ok": True,
        "id": "sample-banner",
        "enabled": False,
    }
    written = json.loads((tmp_path / "mods/client/sample-banner/mod.json").read_text("utf-8"))
    assert written["enabled"] is False
    assert written["name"] == "Sample Banner"
    assert {m["id"]: m for m in api.list_mods()}["sample-banner"]["enabled"] is False
    api.set_mod_enabled("sample-banner", True)
    assert {m["id"]: m for m in api.list_mods()}["sample-banner"]["enabled"] is True

    for bad in ("rainmaker", "missing", "../sim/rainmaker", "Sample-Banner"):
        assert api.set_mod_enabled(bad, True)["ok"] is False, bad


@pytest.mark.parametrize("mode", list(MODES))
def test_launch_starts_the_desktop_app_on_the_world(tmp_path: Path, mode: str) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    result = api.launch("island", mode, True)
    assert result == {"ok": True, "pid": 4242, "world": "island", "mode": mode}
    (command,) = spawned.commands
    assert command[:3] == [sys.executable, "-m", "lineage_server.desktop"]

    def option(name: str) -> str:
        return command[command.index(name) + 1]

    assert Path(option("--data")) == tmp_path / "data" / "island"
    assert Path(option("--config")) == MODES[mode].config
    assert MODES[mode].config.is_file()
    assert float(option("--time-scale")) == MODES[mode].time_scale
    assert option("--years-ahead") == "400"  # the save is in 2426, today in 2026
    assert Path(option("--mods")) == tmp_path / "mods"
    assert command[-1] == "--fullscreen"
    assert spawned.launched.wait(5)  # the launcher closes


def test_launch_windowed_and_on_a_new_world(tmp_path: Path) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    assert api.launch("fresh", "fast", False)["ok"] is True
    (command,) = spawned.commands
    assert "--fullscreen" not in command
    assert command[command.index("--years-ahead") + 1] == "400"


def test_simulated_time_takes_the_chosen_speed_and_day_length(tmp_path: Path) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    assert api.launch("island", "fast", False, 360, 20)["ok"] is True
    (command,) = spawned.commands
    assert float(command[command.index("--time-scale") + 1]) == 360.0
    assert float(command[command.index("--day-minutes") + 1]) == 20.0


def test_simulated_time_defaults_and_live_time_ignores_the_pace(tmp_path: Path) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    api.launch("island", "fast", False)
    api.launch("island", "realtime", False, 360, 20)
    simulated, live = spawned.commands
    assert float(simulated[simulated.index("--time-scale") + 1]) == MODES["fast"].time_scale
    assert float(simulated[simulated.index("--day-minutes") + 1]) == DEFAULT_DAY_MINUTES
    assert float(live[live.index("--time-scale") + 1]) == 1.0
    assert "--day-minutes" not in live


def test_the_modes_offer_speeds_and_day_lengths_to_the_simulated_one(tmp_path: Path) -> None:
    modes = {m["id"]: m for m in _api(tmp_path).modes()}
    assert modes["fast"]["speeds"] == list(SPEEDS)
    assert modes["fast"]["day_minutes"] == list(DAY_MINUTES)
    assert MODES["fast"].time_scale in SPEEDS
    assert DEFAULT_DAY_MINUTES in DAY_MINUTES
    assert modes["realtime"]["speeds"] == []


def test_launch_refuses_speeds_and_day_lengths_not_offered(tmp_path: Path) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    # What a page could send: none of these is offered.
    bad: list[tuple[Any, Any]] = [(7, 60), (0, 60), (-90, 60), (True, 60), ("90", 60), (90, 45)]
    for speed, minutes in bad:
        assert api.launch("island", "fast", False, speed, minutes)["ok"] is False, speed
    assert spawned.commands == []


def test_launch_refuses_bad_worlds_and_modes(tmp_path: Path) -> None:
    spawned = Spawned()
    api = _api(tmp_path, spawned)
    for world in ("..", "../outside", "a/b", "a\\b", ".hidden", "", "x" * 80):
        assert api.launch(world, "fast", False)["ok"] is False, world
    assert api.launch("island", "warp", False)["ok"] is False
    assert spawned.commands == []
    assert not spawned.launched.is_set()


def test_the_browser_bridge_serves_the_page_and_calls_the_api(tmp_path: Path) -> None:
    api = _api(tmp_path)
    server = bridge_server(api, LAUNCHER_PAGE.read_bytes(), "s3cret")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def request(path: str, args: Any = None, token: str | None = "s3cret") -> tuple[int, bytes]:
        data = None if args is None else json.dumps({"args": args}).encode()
        req = urllib.request.Request(base + path, data=data)
        if token is not None:
            req.add_header(TOKEN_HEADER, token)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    try:
        code, page = request("/?token=s3cret")
        assert code == 200
        assert b"LAUNCH" in page
        assert b"pywebview" in page
        code, body = request("/api/list_worlds", [])
        assert code == 200
        assert {w["name"] for w in json.loads(body)} == {"fresh", "island"}
        code, body = request("/api/set_mod_enabled", ["sample-banner", False])
        assert (code, json.loads(body)["enabled"]) == (200, False)
        assert request("/api/list_worlds", [], token=None)[0] == 403
        assert request("/api/list_worlds", [], token="guess")[0] == 403
        assert request("/api/_years_ahead", [], token="s3cret")[0] == 404
        assert request("/api/launch", "island", token="s3cret")[0] == 400
        assert request("/secret.txt")[0] == 404
    finally:
        server.shutdown()
        server.server_close()
