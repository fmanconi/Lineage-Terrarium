"""The world on the SD card: saves, world archives, recovery and retention (S1, ADR 0023).

Layout under the data directory::

    saves/2026-10-28T00-00-00.000Z.lzma      a save, named by the world's instant (UTC)
    archives/world-001-seed-1234.lzma        an ended world's final state (M10), kept forever

Every file is written atomically: to ``<name>.tmp``, fsynced, renamed over the name, and
the directory fsynced, so a power cut at any moment leaves either the old file or the new
one, and at worst a stray ``.tmp`` that `Store.clean` removes on the next start. Names sort
in time order, so the newest save is the last name.

Retention (the owner, 2026-10-28): the newest save of each of the last ``daily_kept`` days
that have one, plus the oldest save of each month. Archives are never deleted.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import re
import sys
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Generic, TypeVar

log = logging.getLogger(__name__)

SAVE_SUFFIX = ".lzma"
TMP_SUFFIX = ".tmp"
_SAVE_NAME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z\.lzma$")

_T = TypeVar("_T")


def write_atomic(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` so that a crash leaves the old file or the new one."""
    tmp = path.with_name(path.name + TMP_SUFFIX)
    with open(tmp, "wb") as file:
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    os.replace(tmp, path)
    if sys.platform != "win32":
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


def save_name(unix_ms: int) -> str:
    """The file name of a save of the world at ``unix_ms``."""
    when = dt.datetime(1970, 1, 1, tzinfo=dt.UTC) + dt.timedelta(milliseconds=unix_ms)
    return when.strftime("%Y-%m-%dT%H-%M-%S.") + f"{unix_ms % 1000:03d}Z{SAVE_SUFFIX}"


def save_instant(name: str) -> dt.datetime | None:
    """The instant a save's name gives, or None for a name that is not a save's."""
    match = _SAVE_NAME.match(name)
    if match is None:
        return None
    year, month, day, hour, minute, second, ms = (int(part) for part in match.groups())
    return dt.datetime(year, month, day, hour, minute, second, ms * 1000, tzinfo=dt.UTC)


def kept(names: Iterable[str], daily_kept: int, monthly_kept: bool) -> set[str]:
    """Which of the saves ``names`` the retention keeps (names not of saves are kept)."""
    dated = sorted((when, name) for name in names if (when := save_instant(name)) is not None)
    keep = {name for name in names if save_instant(name) is None}
    newest_of_day: dict[dt.date, str] = {}
    oldest_of_month: dict[tuple[int, int], str] = {}
    for when, name in dated:
        newest_of_day[when.date()] = name
        oldest_of_month.setdefault((when.year, when.month), name)
    days = sorted(newest_of_day)[-daily_kept:]
    keep.update(newest_of_day[day] for day in days)
    if monthly_kept:
        keep.update(oldest_of_month.values())
    return keep


@dataclass(frozen=True)
class Loaded(Generic[_T]):
    """A save that loaded, and the newer ones that did not."""

    value: _T
    path: Path
    skipped: list[Path]


class Store:
    def __init__(self, data: Path) -> None:
        self.saves_dir = data / "saves"
        self.archives_dir = data / "archives"
        self.saves_dir.mkdir(parents=True, exist_ok=True)
        self.archives_dir.mkdir(parents=True, exist_ok=True)

    def clean(self) -> list[Path]:
        """Remove what a write cut short (``.tmp`` files); returns them."""
        removed: list[Path] = []
        for directory in (self.saves_dir, self.archives_dir):
            for tmp in sorted(directory.glob("*" + TMP_SUFFIX)):
                for attempt in range(5):
                    try:
                        tmp.unlink()
                        break
                    except PermissionError:
                        if attempt == 4:
                            raise
                        time.sleep(0.02)
                removed.append(tmp)
        return removed

    def saves(self) -> list[Path]:
        """The saves, oldest first."""
        return sorted(
            path for path in self.saves_dir.iterdir() if save_instant(path.name) is not None
        )

    def save(self, data: bytes, unix_ms: int) -> Path:
        path = self.saves_dir / save_name(unix_ms)
        write_atomic(path, data)
        return path

    def archive(self, data: bytes, world: int, seed: int) -> Path:
        path = self.archives_dir / f"world-{world:03d}-seed-{seed}{SAVE_SUFFIX}"
        write_atomic(path, data)
        return path

    def load_newest(self, load: Callable[[bytes], _T]) -> Loaded[_T] | None:
        """The newest save that ``load`` accepts; None when there is none. A save that
        fails to load (truncated, corrupt, unreadable) is logged and passed over."""
        skipped: list[Path] = []
        for path in reversed(self.saves()):
            try:
                value = load(path.read_bytes())
            except (ValueError, OSError, EOFError, KeyError) as exc:
                log.warning("save %s does not load: %s", path.name, exc)
                skipped.append(path)
                continue
            return Loaded(value, path, skipped)
        return None

    def prune(self, daily_kept: int, monthly_kept: bool) -> list[Path]:
        """Delete the saves the retention does not keep; returns them."""
        saves = self.saves()
        keep = kept((path.name for path in saves), daily_kept, monthly_kept)
        removed = [path for path in saves if path.name not in keep]
        for path in removed:
            path.unlink()
        return removed
