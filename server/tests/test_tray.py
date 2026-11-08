"""Tests for the desktop app's tray icon and background mode."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from PIL import Image

from lineage_server.tray import (
    CLOSE_ACTIONS,
    DIALOG_TEXT,
    DIALOG_TITLE,
    ICON_SIZE,
    SHOW_LABEL,
    EXIT_LABEL,
    CloseAction,
    TrayController,
    ask_close_action,
    create_tray_icon_image,
)


def test_tray_icon_image_is_crisp_rgba() -> None:
    img = create_tray_icon_image()
    assert isinstance(img, Image.Image)
    assert img.size == (ICON_SIZE, ICON_SIZE)
    assert img.mode == "RGBA"

    scaled = create_tray_icon_image(size=64)
    assert scaled.size == (64, 64)


def test_ask_close_action_with_prompt() -> None:
    for action in CLOSE_ACTIONS:
        assert ask_close_action(prompt=lambda a=action: a) == action

    # Invalid prompt answer falls back safely to cancel
    assert ask_close_action(prompt=lambda: "invalid_choice") == "cancel"


def test_ask_close_action_falls_back_when_backends_fail() -> None:
    def failing_backend() -> CloseAction:
        raise RuntimeError("GUI unavailable")

    assert ask_close_action(backends=[failing_backend]) == "exit"


def test_tray_controller_lifecycle() -> None:
    on_show = MagicMock()
    on_exit = MagicMock()

    mock_icon = MagicMock()
    created_icons: list[Any] = []

    def mock_factory(name: str, image: Image.Image, title: str, menu: Any) -> Any:
        created_icons.append((name, image, title, menu))
        return mock_icon

    controller = TrayController(
        on_show=on_show,
        on_exit=on_exit,
        title="Test Title",
        icon_factory=mock_factory,
    )

    assert not controller.running
    menu_items = controller.menu()
    assert len(menu_items) == 2
    assert menu_items[0][0] == SHOW_LABEL
    assert menu_items[1][0] == EXIT_LABEL

    # Start icon
    controller.start()
    assert controller.running
    assert len(created_icons) == 1
    assert created_icons[0][0] == "lineage-terrarium"
    assert created_icons[0][2] == "Test Title"
    mock_icon.run_detached.assert_called_once()

    # Second start does nothing
    controller.start()
    assert len(created_icons) == 1

    # Show action
    controller.show()
    assert not controller.running
    mock_icon.stop.assert_called_once()
    on_show.assert_called_once()

    # Start again and exit
    mock_icon.reset_mock()
    controller.start()
    assert controller.running
    controller.exit()
    assert not controller.running
    mock_icon.stop.assert_called_once()
    on_exit.assert_called_once()
