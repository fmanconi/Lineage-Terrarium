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

    def resize(self, width: int, height: int) -> None:
        self.width = width
        self.height = height


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


def test_desktop_api_opacity_and_on_top() -> None:
    api = DesktopApi()
    win = FakeWindow()
    api._window = win

    # Clamping opacity between 0.15 and 1.0
    assert api.set_opacity(0.8) == 0.8
    assert api.get_opacity() == 0.8
    assert api.set_opacity(0.05) == 0.15
    assert api.set_opacity(1.5) == 1.0

    # On top flag
    assert api.set_on_top(True) is True
    assert win.on_top is True
    assert api.set_on_top(False) is False
    assert win.on_top is False


def test_desktop_api_resize_window() -> None:
    api = DesktopApi()
    win = FakeWindow(1000, 600)
    api._window = win

    res = api.resize_window(480, 280)
    assert res == {"width": 480, "height": 280}
    assert win.width == 480
    assert win.height == 280

    # Clamping boundaries
    assert api.resize_window(50, 50) == {"width": 200, "height": 120}


def test_desktop_api_toggle_miniature_mode() -> None:
    api = DesktopApi()
    win = FakeWindow(1366, 820)
    api._window = win

    # Activate miniature mode
    state = api.toggle_miniature(width=384, height=224, opacity=0.75)
    assert state["active"] is True
    assert state["width"] == 384
    assert state["height"] == 224
    assert state["opacity"] == 0.75
    assert win.width == 384
    assert win.height == 224
    assert win.on_top is True
    assert api.get_opacity() == 0.75

    # Toggle again -> restore original dimensions and opacity
    restored = api.toggle_miniature()
    assert restored["active"] is False
    assert restored["width"] == 1366
    assert restored["height"] == 820
    assert restored["opacity"] == 1.0
    assert win.width == 1366
    assert win.height == 820
    assert win.on_top is False
    assert api.get_opacity() == 1.0
