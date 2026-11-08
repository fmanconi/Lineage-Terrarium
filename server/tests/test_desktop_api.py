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
