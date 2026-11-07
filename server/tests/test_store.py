"""The save store (S1): atomic writes, retention, recovery, and a kill -9 during a save."""

from __future__ import annotations

import datetime as dt
import os
import random
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from lineage_server.settings import (
    DEFAULT_SETTINGS,
    SettingsError,
    load_settings,
    parse_settings,
)
from lineage_server.store import Store, kept, save_instant, save_name, write_atomic
from lineage_sim.state import io

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
DAY_MS = 86_400_000
# 2026-10-28T00:00:00Z
MIDNIGHT_MS = 1_793_145_600_000


def test_the_default_settings_parse() -> None:
    settings = load_settings(DEFAULT_SETTINGS)
    assert settings.daily_kept == 7
    assert settings.monthly_kept is True


@pytest.mark.parametrize(
    "change",
    [
        ("port = 8080", "port = 0"),
        ("port = 8080", 'port = "8080"'),
        ("monthly_kept = true", "monthly_kept = 1"),
        ("daily_kept = 7", "daily_kept = 7\nweekly_kept = 2"),
        ("[status]", "[statuss]"),
    ],
)
def test_bad_settings_are_refused(change: tuple[str, str]) -> None:
    text = DEFAULT_SETTINGS.read_text(encoding="utf-8").replace(*change)
    with pytest.raises(SettingsError):
        parse_settings(text)


def test_save_names_sort_in_time_and_round_trip() -> None:
    times = [MIDNIGHT_MS + k * 3_600_123 for k in range(30)]
    names = [save_name(t) for t in times]
    assert names == sorted(names)
    assert names[0] == "2026-10-28T00-00-00.000Z.lzma"
    for t, name in zip(times, names, strict=True):
        when = save_instant(name)
        assert when is not None
        assert round(when.timestamp() * 1000) == t
    assert save_instant("notes.txt") is None
    assert save_instant(names[0] + ".tmp") is None


def _days(first: dt.date, count: int, per_day: int = 1) -> list[str]:
    names: list[str] = []
    for day in range(count):
        date = first + dt.timedelta(days=day)
        start = int(dt.datetime(date.year, date.month, date.day, tzinfo=dt.UTC).timestamp())
        names += [save_name(start * 1000 + k * 3_600_000) for k in range(per_day)]
    return names


def test_retention_keeps_the_last_days_newest_and_each_months_oldest() -> None:
    names = _days(dt.date(2026, 8, 20), 70, per_day=3)
    keep = kept(names, daily_kept=7, monthly_kept=True)
    last_days = [name for name in names[-21:] if name.endswith("T02-00-00.000Z.lzma")]
    assert set(last_days) <= keep
    assert len(last_days) == 7
    firsts = {"2026-08-20T00-00-00.000Z.lzma", "2026-09-01T00-00-00.000Z.lzma"}
    firsts |= {"2026-10-01T00-00-00.000Z.lzma"}
    assert firsts <= keep
    assert len(keep) == 7 + 3
    assert kept(names, daily_kept=7, monthly_kept=False) == set(last_days)


def test_retention_counts_days_that_have_a_save() -> None:
    # A device off for weeks: the last seven saved days, however far apart.
    names = _days(dt.date(2026, 1, 1), 3) + _days(dt.date(2026, 3, 1), 3)
    names += _days(dt.date(2026, 6, 1), 3)
    keep = kept(names, daily_kept=7, monthly_kept=False)
    assert keep == set(names[-7:])


def test_retention_always_keeps_the_newest_and_other_files() -> None:
    names = [*_days(dt.date(2026, 10, 1), 20, per_day=2), "README"]
    keep = kept(names, daily_kept=1, monthly_kept=False)
    assert keep == {names[-2], "README"}


def test_write_atomic_replaces_and_leaves_no_tmp(tmp_path: Path) -> None:
    path = tmp_path / "a.lzma"
    write_atomic(path, b"one")
    write_atomic(path, b"two")
    assert path.read_bytes() == b"two"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a.lzma"]


def test_store_prunes_and_finds_the_newest(tmp_path: Path) -> None:
    store = Store(tmp_path)
    for k in range(12):
        store.save(f"save {k}".encode(), MIDNIGHT_MS + k * DAY_MS)
    removed = store.prune(daily_kept=7, monthly_kept=True)
    # Oct 28 to Nov 8 saved: kept Nov 2-8, and the months' oldest, Oct 28 and Nov 1.
    assert len(store.saves()) == 9
    assert len(removed) == 3
    loaded = store.load_newest(lambda data: data.decode())
    assert loaded is not None
    assert loaded.value == "save 11"
    assert loaded.skipped == []


def test_a_corrupt_newest_save_is_passed_over(tmp_path: Path) -> None:
    store = Store(tmp_path)
    good = FIXTURE.read_bytes()
    store.save(good, MIDNIGHT_MS)
    newest = store.save(good[: len(good) // 2], MIDNIGHT_MS + DAY_MS)
    loaded = store.load_newest(io.loads)
    assert loaded is not None
    assert loaded.path.name == save_name(MIDNIGHT_MS)
    assert loaded.skipped == [newest]


def test_no_save_loads_none(tmp_path: Path) -> None:
    assert Store(tmp_path).load_newest(io.loads) is None


def test_archives_are_named_by_world_and_seed(tmp_path: Path) -> None:
    store = Store(tmp_path)
    path = store.archive(b"x", world=3, seed=4242)
    assert path.name == "world-003-seed-4242.lzma"
    assert store.prune(daily_kept=1, monthly_kept=False) == []
    assert path.exists()


# The child saves in a loop as fast as it can, each save a different instant, until it is
# killed; it says "ready" once the first save is down.
_CHILD = """
import sys
from pathlib import Path
from lineage_server.store import Store
store = Store(Path(sys.argv[1]))
data = Path(sys.argv[2]).read_bytes()
t = int(sys.argv[3])
store.save(data, t)
print("ready", flush=True)
while True:
    t += 1000
    store.save(data, t)
"""

KILLS = 20


def test_kill_9_during_saves_leaves_a_loadable_save(tmp_path: Path) -> None:
    """Killed at random moments while saving (seeded), the store always has a save that
    loads, and the next start removes what the kill cut short."""
    chooser = random.Random(1234)
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    store = Store(tmp_path)
    for kill in range(KILLS):
        child = subprocess.Popen(
            [sys.executable, "-c", _CHILD, str(tmp_path), str(FIXTURE), str(MIDNIGHT_MS)],
            stdout=subprocess.PIPE,
            env=env,
            text=True,
        )
        assert child.stdout is not None
        assert child.stdout.readline().strip() == "ready"
        time.sleep(chooser.uniform(0.0, 0.15))
        sigkill = getattr(signal, "SIGKILL", None)
        if sigkill is not None:
            child.send_signal(sigkill)
        else:
            child.kill()
        child.wait()
        child.stdout.close()
        store.clean()
        loaded = store.load_newest(io.loads)
        assert loaded is not None, f"no save loads after kill {kill}"
        assert loaded.skipped == [], f"a save broken by kill {kill}: {loaded.skipped}"
        assert not list(tmp_path.rglob("*.tmp"))
        # Each child starts over from the same instant: keep the folder small.
        for path in store.saves():
            path.unlink()
