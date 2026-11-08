from __future__ import annotations

from lineage_server.desktop import DesktopApi


class FakeWindow:
    def __init__(self, width: int = 1366, height: int = 820) -> None:
        self.uid = "test-window"
        self.width = width
        self.height = height
        self.x = 100
        self.y = 100
        self.on_top = False
        self.fullscreen = False

    def toggle_fullscreen(self) -> None:
        self.fullscreen = not self.fullscreen


def test_desktop_api_fullscreen_toggle() -> None:
    api = DesktopApi()
    assert api.is_desktop() is True
    assert api.toggle_fullscreen() is False  # No window attached

    win = FakeWindow()
    api._window = win
    assert api.toggle_fullscreen() is True
    assert win.fullscreen is True
    assert api.toggle_fullscreen() is False
    assert win.fullscreen is False


class FakeMiniature(FakeWindow):
    def __init__(self) -> None:
        super().__init__(448, 263)
        self.destroyed = False
        self.resized: list[tuple[int, int, object]] = []

    def destroy(self) -> None:
        self.destroyed = True

    def resize(self, width: int, height: int, fix_point: object = None) -> None:
        self.resized.append((width, height, fix_point))


class FakeGameWindow(FakeWindow):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []

    def run_js(self, script: str) -> None:
        self.calls.append(f"js:{script}")

    def show(self) -> None:
        self.calls.append("show")

    def restore(self) -> None:
        self.calls.append("restore")

    def minimize(self) -> None:
        self.calls.append("minimize")


def test_pip_geometry_first_time_sits_bottom_right() -> None:
    from lineage_server.desktop import PIP_MARGIN, pip_geometry

    x, y, w, h = pip_geometry((0, 0, 1707, 1019), None)
    assert (w, h) == (448, 262)
    assert x == 1707 - 448 - PIP_MARGIN
    assert y == 1019 - 262 - PIP_MARGIN


def test_pip_geometry_keeps_a_saved_place_on_screen_only() -> None:
    from lineage_server.desktop import pip_geometry

    assert pip_geometry((0, 0, 1707, 1019), {"x": 40, "y": 50, "width": 600}) == (
        40,
        50,
        600,
        352,
    )
    # Off the screen (a monitor unplugged): back to the corner, size kept.
    x, _, w, _ = pip_geometry((0, 0, 1707, 1019), {"x": 3000, "y": 50, "width": 600})
    assert (w, x < 1707) == (600, True)
    # Too small or too big a saved width is clamped; garbage is ignored.
    assert pip_geometry((0, 0, 1707, 1019), {"width": 10})[2] == 240
    assert pip_geometry((0, 0, 1707, 1019), {"width": 99999})[2] <= 1707
    assert pip_geometry((0, 0, 1707, 1019), {"x": "a", "width": "b"})[2] == 448


def test_close_pip_saves_place_and_brings_the_game_back(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import json

    state = tmp_path / "pip-window.json"
    api = DesktopApi(pip_url="http://x/?pip=1", pip_state=state)
    game = FakeGameWindow()
    pip = FakeMiniature()
    api._window = game
    api._pip = pip
    assert api.pip_open() is True

    assert api.close_pip(back=True) is True
    assert pip.destroyed is True
    assert api.pip_open() is False
    assert json.loads(state.read_text(encoding="utf-8")) == {"x": 100, "y": 100, "width": 448}
    assert game.calls == ["js:window.__pipAway && window.__pipAway(false)", "show", "restore"]
    assert api.close_pip() is False  # Nothing open any more


def test_close_pip_without_back_leaves_the_game_minimised() -> None:
    api = DesktopApi()
    game = FakeGameWindow()
    api._window = game
    api._pip = FakeMiniature()
    api.close_pip(back=False)
    assert game.calls[-1] == "minimize"


def test_pip_closed_from_outside_brings_the_game_back() -> None:
    api = DesktopApi()
    game = FakeGameWindow()
    pip = FakeMiniature()
    api._window, api._pip = game, pip
    api._pip_closed(pip)
    assert api.pip_open() is False
    assert game.calls[-1] == "restore"
    # A stale close event of an older miniature does nothing.
    game.calls.clear()
    api._pip_closed(pip)
    assert game.calls == []


def test_pip_resize_keeps_the_ratio_and_the_opposite_corner() -> None:
    from lineage_server.desktop import EDGE_LEFT, EDGE_TOP
    from webview.window import FixPoint

    api = DesktopApi()
    pip = FakeMiniature()
    api._pip = pip
    assert api.pip_resize(600, 1, EDGE_LEFT | EDGE_TOP) == {"width": 600, "height": 352}
    assert pip.resized[-1] == (600, 352, FixPoint.EAST | FixPoint.SOUTH)
    assert api.pip_resize(10, 10, 0)["width"] == 240
    assert pip.resized[-1][2] == FixPoint.WEST | FixPoint.NORTH


def test_prefs_are_kept_on_disk_for_the_game_keys_only(tmp_path) -> None:  # type: ignore[no-untyped-def]
    prefs = tmp_path / "desktop-prefs.json"
    api = DesktopApi(prefs=prefs)
    assert api.prefs_get() == {}
    assert api.prefs_set("lineage_biophony_settings_v1", '{"muted":true}') is True
    assert api.prefs_set("lineage_mods_state_v1", '{"health-bars":false}') is True
    assert api.prefs_set("someone_else", "x") is False
    assert api.prefs_set("lineage_huge", "x" * 70_000) is False
    # A new launch (another port, another page) finds them again.
    again = DesktopApi(prefs=prefs)
    assert again.prefs_get() == {
        "lineage_biophony_settings_v1": '{"muted":true}',
        "lineage_mods_state_v1": '{"health-bars":false}',
    }


def test_prefs_survive_a_broken_file(tmp_path) -> None:  # type: ignore[no-untyped-def]
    prefs = tmp_path / "desktop-prefs.json"
    prefs.write_text("{ not json", encoding="utf-8")
    api = DesktopApi(prefs=prefs)
    assert api.prefs_get() == {}
    assert api.prefs_set("lineage_x", "1") is True
    assert api.prefs_get() == {"lineage_x": "1"}
