"""The desktop app's background mode: a tray icon that keeps the island alive.

Closing the game window asks what to do (`ask_close_action`): carry on in the background,
save and exit, or cancel. In the background the window is hidden, the embedded server keeps
ticking, and a tray icon (`TrayController`, ``pystray``) brings the window back on a click
or saves and exits from its menu.

The dialog is a WinForms one on Windows (``pythonnet``, which pywebview already brings),
Tkinter elsewhere; without either (a headless machine, a test) the answer is ``exit``, the
window's behaviour before this mode existed.
"""

from __future__ import annotations

import logging
import sys
import threading
from collections.abc import Callable
from typing import Any, Literal

from PIL import Image

log = logging.getLogger("lineage_tray")

CloseAction = Literal["background", "exit", "cancel"]
CLOSE_ACTIONS: tuple[CloseAction, ...] = ("background", "exit", "cancel")

TRAY_TITLE = "Lineage: Terrarium"
SHOW_LABEL = "Mostra Terrarium"
EXIT_LABEL = "Salva ed Esci"

DIALOG_TITLE = "Lineage: Terrarium"
DIALOG_TEXT = (
    "Vuoi lasciare l'isola viva in background?\n"
    "Il Terrarium continua a evolversi e resta un'icona accanto all'orologio."
)
BUTTON_LABELS: dict[CloseAction, str] = {
    "background": "Continua in background",
    "exit": "Salva ed esci",
    "cancel": "Annulla",
}

ICON_SIZE = 32

# The icon's palette: a glass jar on a night sky, dark soil, a two-leaf sprout.
_PALETTE: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "o": (16, 8, 28, 255),  # outline, the scene's background colour
    "g": (150, 205, 225, 255),  # glass
    "h": (225, 245, 250, 255),  # glass highlight
    "a": (40, 52, 84, 255),  # air inside the jar
    "s": (101, 67, 45, 255),  # soil
    "d": (70, 45, 32, 255),  # soil, shaded
    "l": (120, 200, 80, 255),  # leaf
    "L": (70, 145, 60, 255),  # leaf, shaded
    "t": (60, 120, 50, 255),  # stem
    "c": (180, 120, 70, 255),  # cork
}

# 32 rows of 32 pixels; every row is checked in `create_tray_icon_image`.
_ICON_ROWS = (
    "................................",
    "................................",
    "...........oooooooooo...........",
    "...........occcccccco...........",
    "...........occcccccco...........",
    "..........oooooooooooo..........",
    "........ooggggggggggggoo........",
    ".......oghaaaaaaaaaaaaago.......",
    "......oghaaaaaaaaaaaaaaago......",
    "......ogaaaaaaaaaaaaaaaago......",
    ".....oghaaaaaaaaaaaaaaaaago.....",
    ".....oghaaaaaallaaaaaaaaago.....",
    ".....ogaaaaaalllLaaaaaaaago.....",
    ".....ogaaaaalllLLaaLlaaaago.....",
    ".....ogaaaaaallLtaLlllaaago.....",
    ".....ogaaaaaaaaLtLllllaaago.....",
    ".....ogaaaaaaaaatLLlaaaaago.....",
    ".....ogaaaaaaaaataaaaaaaago.....",
    ".....ogaaaaaaaaataaaaaaaago.....",
    ".....ogaaaaaaaaataaaaaaaago.....",
    ".....ogaaaaaaaaataaaaaaaago.....",
    ".....ogsssssssssstssssssssgo....",
    ".....ogssdssssssssssdssssgo.....",
    ".....ogsssssdsssssssssdssgo.....",
    ".....ogsdssssssssdsssssssgo.....",
    ".....ogsssssssdssssssdsssgo.....",
    "......ogsssdsssssssssssgo.......",
    "......oggggggggggggggggo........",
    ".......oooooooooooooooo.........",
    "................................",
    "................................",
    "................................",
)


def _icon_rows() -> list[str]:
    """The icon's rows as a list."""
    return list(_ICON_ROWS)


def create_tray_icon_image(size: int = ICON_SIZE) -> Image.Image:
    """The tray's icon: a sprout in a corked glass terrarium, as hard-edged pixel art.

    Prefers the high-resolution asset at ``deploy/lineage.png`` if available, resized
    cleanly with Lanczos. Otherwise builds from the 32×32 pixel map.
    """
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[2]
    custom_png = repo_root / "deploy" / "lineage.png"
    if custom_png.is_file():
        try:
            loaded = Image.open(custom_png).convert("RGBA")
            return loaded.resize((size, size), Image.Resampling.LANCZOS)
        except Exception:
            pass

    rows = _icon_rows()
    if len(rows) != ICON_SIZE or any(len(row) != ICON_SIZE for row in rows):
        raise ValueError("the tray icon's pixel map must be 32×32")
    image = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), _PALETTE["."])
    pixels = image.load()
    assert pixels is not None
    for y, row in enumerate(rows):
        for x, key in enumerate(row):
            pixels[x, y] = _PALETTE[key]
    if size != ICON_SIZE:
        image = image.resize((size, size), Image.Resampling.NEAREST)
    return image


def _ask_winforms() -> CloseAction:
    """The question as a fixed WinForms dialog with three buttons (Windows)."""
    import clr  # type: ignore[import-not-found]  # pythonnet, brought by pywebview

    clr.AddReference("System.Windows.Forms")  # type: ignore[attr-defined]
    clr.AddReference("System.Drawing")  # type: ignore[attr-defined]
    import System.Drawing as Drawing  # type: ignore[import-not-found]
    import System.Windows.Forms as WinForms  # type: ignore[import-not-found]

    form: Any = WinForms.Form()
    form.Text = DIALOG_TITLE
    form.FormBorderStyle = WinForms.FormBorderStyle.FixedDialog
    form.StartPosition = WinForms.FormStartPosition.CenterScreen
    form.MaximizeBox = False
    form.MinimizeBox = False
    form.ShowInTaskbar = False
    form.TopMost = True
    form.ClientSize = Drawing.Size(460, 140)

    label: Any = WinForms.Label()
    label.Text = DIALOG_TEXT
    label.Location = Drawing.Point(16, 16)
    label.Size = Drawing.Size(428, 60)
    form.Controls.Add(label)

    choice: dict[str, CloseAction] = {"value": "cancel"}

    def button(action: CloseAction, x: int, width: int) -> Any:
        b: Any = WinForms.Button()
        b.Text = BUTTON_LABELS[action]
        b.Location = Drawing.Point(x, 92)
        b.Size = Drawing.Size(width, 32)

        def clicked(_sender: Any, _args: Any) -> None:
            choice["value"] = action
            form.Close()

        b.Click += clicked
        form.Controls.Add(b)
        return b

    default = button("background", 16, 170)
    button("exit", 196, 130)
    cancel = button("cancel", 336, 108)
    form.AcceptButton = default
    form.CancelButton = cancel
    form.ShowDialog()
    form.Dispose()
    return choice["value"]


def _ask_tkinter() -> CloseAction:
    """The same question in a small Tkinter window (Linux, macOS)."""
    import tkinter as tk

    root = tk.Tk()
    root.title(DIALOG_TITLE)
    root.resizable(False, False)
    root.attributes("-topmost", True)  # pyright: ignore[reportUnknownMemberType]
    choice: dict[str, CloseAction] = {"value": "cancel"}

    def pick(action: CloseAction) -> None:
        choice["value"] = action
        root.destroy()

    tk.Label(root, text=DIALOG_TEXT, justify="left", padx=16, pady=12).pack()
    row = tk.Frame(root, padx=12, pady=12)
    row.pack()
    for action in CLOSE_ACTIONS:
        tk.Button(row, text=BUTTON_LABELS[action], command=lambda a=action: pick(a)).pack(
            side="left", padx=4
        )
    root.protocol("WM_DELETE_WINDOW", lambda: pick("cancel"))
    root.bind("<Escape>", lambda _e: pick("cancel"))  # pyright: ignore[reportUnknownMemberType]
    root.mainloop()
    return choice["value"]


def _default_backends() -> list[Callable[[], CloseAction]]:
    if sys.platform == "win32":
        return [_ask_winforms, _ask_tkinter]
    return [_ask_tkinter]


def ask_close_action(
    prompt: Callable[[], str] | None = None,
    *,
    backends: list[Callable[[], CloseAction]] | None = None,
) -> CloseAction:
    """Ask, when the window closes, whether to go on in the background or save and exit.

    Returns ``"background"``, ``"exit"`` or ``"cancel"``. ``prompt`` replaces the dialog
    (a test, a scripted run); otherwise each dialog backend is tried in turn, and if none
    can be shown the answer is ``"exit"``. An answer that is none of the three is read as
    ``"cancel"``: the window stays open, nothing is lost.
    """
    if prompt is not None:
        answer = prompt()
        return answer if answer in CLOSE_ACTIONS else "cancel"  # type: ignore[return-value]
    for backend in backends if backends is not None else _default_backends():
        try:
            answer = backend()
        except Exception:
            log.warning("Close dialog %s unavailable", backend.__name__, exc_info=True)
            continue
        return answer if answer in CLOSE_ACTIONS else "cancel"
    log.info("No close dialog could be shown; saving and exiting")
    return "exit"


def _pystray_factory(
    name: str, icon: Image.Image, title: str, menu: tuple[tuple[str, Callable[[], None], bool], ...]
) -> Any:
    import pystray  # pyright: ignore[reportMissingImports]

    items = [
        pystray.MenuItem(text, lambda _icon, _item, act=act: act(), default=default)
        for text, act, default in menu
    ]
    return pystray.Icon(name, icon, title, menu=pystray.Menu(*items))


IconFactory = Callable[
    [str, Image.Image, str, tuple[tuple[str, Callable[[], None], bool], ...]], Any
]


class TrayController:
    """The tray icon shown while the window is hidden.

    ``on_show`` runs on a click of the icon or of *Mostra Terrarium*; ``on_exit`` on *Salva
    ed Esci*. The icon goes away before either runs. A stopped controller can be started
    again: each start builds a fresh ``pystray.Icon`` (one cannot be run twice).
    """

    def __init__(
        self,
        on_show: Callable[[], None],
        on_exit: Callable[[], None],
        *,
        title: str = TRAY_TITLE,
        icon_factory: IconFactory | None = None,
    ) -> None:
        self._on_show = on_show
        self._on_exit = on_exit
        self._title = title
        self._factory = icon_factory or _pystray_factory
        self._image = create_tray_icon_image()
        self._icon: Any = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self._icon is not None

    def menu(self) -> tuple[tuple[str, Callable[[], None], bool], ...]:
        """The menu: label, action, whether it is the click's default."""
        return ((SHOW_LABEL, self.show, True), (EXIT_LABEL, self.exit, False))

    def start(self) -> None:
        """Show the icon, its loop on a thread of its own; a second start does nothing."""
        with self._lock:
            if self._icon is not None:
                return
            icon = self._factory("lineage-terrarium", self._image, self._title, self.menu())
            icon.run_detached()
            self._icon = icon
        log.info("Tray icon shown; the island goes on in the background")

    def stop(self) -> None:
        """Take the icon away; stopping a stopped controller does nothing."""
        with self._lock:
            icon, self._icon = self._icon, None
        if icon is None:
            return
        try:
            icon.visible = False
        except Exception:
            log.debug("Tray icon could not be hidden", exc_info=True)
        icon.stop()

    def show(self) -> None:
        self.stop()
        self._on_show()

    def exit(self) -> None:
        self.stop()
        self._on_exit()
