/**
 * The mod menu (`M`, ADR 0024): a modal card centred on the screen (`320×200` art pixels on
 * the `512×300` scene), in the wooden frame, cream card and bitmap font of `keybar.ts` and
 * `card.ts`, lit by `lantern` like them. It lists the registered mods with `ON`/`OFF`
 * badges, describes the one highlighted, and toggles it with `Space`/`Enter` or a click.
 */
import {
  DAYLIGHT,
  FADED_INK,
  INK,
  SHADOW_ALPHA,
  SHADOW_COLOUR,
  lampKey,
  lightPicture,
  type Picture,
} from "../captions";
import type { Rgb } from "../atmosphere/light";
import { paintKeycap, keycapWidth, type KeyGlyph } from "../keybar";
import { draw, measure, wrap } from "../pixelfont";
import type { ModRegistry } from "./registry";

/** Colours matching `keybar.ts` and `card.ts`. */
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const FRAME_SHADE = 0x6b3f22;
const CARD = 0xfaf3e1;
const CARD_SHADE = 0xe7dabd;
const ROW_LIT = 0xf3e6c8;
const ON_FILL = 0x6fb03a;
const ON_EDGE = 0x3f7a22;
const OFF_FILL = 0xb59e78;
const OFF_EDGE = 0x7a6855;

/** The card's size in art pixels, its 1-pixel shadow left out. */
export const MENU_WIDTH = 320;
export const MENU_HEIGHT = 200;
const SHADOW = 1;

const TITLE_TOP = 6;
const RULE_Y = 18;
const ROW_TOP = 22;
const ROW_HEIGHT = 13;
/** Rows shown at once; the list scrolls past them. */
export const VISIBLE_ROWS = 6;
const LIST_LEFT = 8;
const LIST_RIGHT = MENU_WIDTH - 9;
const INDEX_X = 12;
const BADGE_X = 22;
const BADGE_WIDTH = 23;
const NAME_X = 52;
const DESCRIPTION_RULE_Y = ROW_TOP + VISIBLE_ROWS * ROW_HEIGHT + 3;
const DESCRIPTION_TOP = DESCRIPTION_RULE_Y + 5;
const DESCRIPTION_LINE = 11;
const DESCRIPTION_LINES = 4;
const TEXT_LEFT = 12;
const TEXT_WIDTH = MENU_WIDTH - 2 * TEXT_LEFT;
const HINTS_TOP = MENU_HEIGHT - 20;
const HINT_GAP = 3;
const HINTS_GAP = 10;

export interface MenuEntry {
  name: string;
  version: string;
  author?: string;
  description: string;
  enabled: boolean;
}

export interface MenuLayout {
  picture: Picture;
  /** The list's rows on the card: `index` into the entries, `y0`–`y1` inclusive. */
  rows: { index: number; y0: number; y1: number }[];
  /** The `Esc Close` hint, `x0`–`x1` inclusive, on the hint line. */
  close: { x0: number; x1: number };
}

/** The first row shown so that `selected` stays in view, moved as little as possible. */
export function scrollOffset(selected: number, offset: number, count: number): number {
  const last = Math.max(0, count - VISIBLE_ROWS);
  let next = Math.min(Math.max(offset, 0), last);
  if (selected < next) next = selected;
  if (selected >= next + VISIBLE_ROWS) next = selected - VISIBLE_ROWS + 1;
  return Math.min(Math.max(next, 0), last);
}

/** Pure pixel painter for the mod menu. */
export function paintModMenu(
  entries: readonly MenuEntry[],
  selected: number,
  offset: number,
): MenuLayout {
  const width = MENU_WIDTH + SHADOW;
  const height = MENU_HEIGHT + SHADOW;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, colour: number, alpha = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (y * width + x);
    rgba[at] = (colour >> 16) & 255;
    rgba[at + 1] = (colour >> 8) & 255;
    rgba[at + 2] = colour & 255;
    rgba[at + 3] = alpha;
  };
  const fill = (x0: number, y0: number, w: number, h: number, colour: number): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, colour);
  };
  const text = (words: string, x: number, y: number, colour: number): number =>
    draw(words, x, y, (px, py) => put(px, py, colour));

  for (let y = SHADOW; y < height; y++) {
    for (let x = SHADOW; x < width; x++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  }
  for (let y = 0; y < MENU_HEIGHT; y++) {
    for (let x = 0; x < MENU_WIDTH; x++) {
      const ring = Math.min(x, y, MENU_WIDTH - 1 - x, MENU_HEIGHT - 1 - y);
      if (ring === 0) put(x, y, FRAME_EDGE);
      else if (ring === 1) put(x, y, Math.min(x, y) === 1 ? FRAME_LIT : FRAME_SHADE);
      else put(x, y, x === 2 || y === 2 ? CARD_SHADE : CARD);
    }
  }

  const title = "MODS";
  text(title, Math.round((MENU_WIDTH - measure(title)) / 2), TITLE_TOP, INK);
  fill(LIST_LEFT, RULE_Y, LIST_RIGHT - LIST_LEFT + 1, 1, CARD_SHADE);

  const rows: MenuLayout["rows"] = [];
  if (entries.length === 0) {
    text("No mods installed.", TEXT_LEFT, ROW_TOP + 2, FADED_INK);
  }
  const shown = entries.slice(offset, offset + VISIBLE_ROWS);
  shown.forEach((entry, i) => {
    const index = offset + i;
    const y0 = ROW_TOP + i * ROW_HEIGHT;
    if (index === selected) fill(LIST_LEFT, y0, LIST_RIGHT - LIST_LEFT + 1, ROW_HEIGHT, ROW_LIT);
    text(String(index + 1), INDEX_X, y0 + 2, FADED_INK);
    const edge = entry.enabled ? ON_EDGE : OFF_EDGE;
    fill(BADGE_X, y0 + 1, BADGE_WIDTH, ROW_HEIGHT - 2, edge);
    fill(BADGE_X + 1, y0 + 2, BADGE_WIDTH - 2, ROW_HEIGHT - 4, entry.enabled ? ON_FILL : OFF_FILL);
    const badge = entry.enabled ? "ON" : "OFF";
    text(badge, BADGE_X + Math.round((BADGE_WIDTH - measure(badge)) / 2), y0 + 2, CARD);
    text(entry.name, NAME_X, y0 + 2, entry.enabled ? INK : FADED_INK);
    rows.push({ index, y0, y1: y0 + ROW_HEIGHT - 1 });
  });
  // Arrows on the right when the list goes on above or below.
  const arrow = (y: number, up: boolean): void => {
    for (let r = 0; r < 3; r++)
      fill(LIST_RIGHT - 6 + (up ? 2 - r : r), y + r, 1 + 2 * (up ? r : 2 - r), 1, FADED_INK);
  };
  if (offset > 0) arrow(ROW_TOP + 2, true);
  if (offset + VISIBLE_ROWS < entries.length) {
    arrow(ROW_TOP + VISIBLE_ROWS * ROW_HEIGHT - 5, false);
  }

  fill(LIST_LEFT, DESCRIPTION_RULE_Y, LIST_RIGHT - LIST_LEFT + 1, 1, CARD_SHADE);
  const chosen = entries[selected];
  if (chosen !== undefined) {
    let x = TEXT_LEFT;
    x += text(chosen.name, x, DESCRIPTION_TOP, INK);
    x += text(` v${chosen.version}`, x, DESCRIPTION_TOP, FADED_INK);
    if (chosen.author !== undefined) text(` by ${chosen.author}`, x, DESCRIPTION_TOP, FADED_INK);
    wrap(chosen.description, TEXT_WIDTH)
      .slice(0, DESCRIPTION_LINES)
      .forEach((line, i) => {
        text(line, TEXT_LEFT, DESCRIPTION_TOP + (i + 1) * DESCRIPTION_LINE + 1, INK);
      });
  }

  const hints: { key: KeyGlyph; label: string }[] = [
    { key: { kind: "arrows", arrows: "upDown" }, label: "Move" },
    { key: { kind: "text", text: "Space" }, label: "Toggle" },
    { key: { kind: "text", text: "Esc" }, label: "Close" },
  ];
  const hintWidth = (h: (typeof hints)[number]): number =>
    keycapWidth(h.key) + HINT_GAP + measure(h.label);
  const total = hints.reduce((sum, h) => sum + hintWidth(h), 0) + (hints.length - 1) * HINTS_GAP;
  let cursor = Math.round((MENU_WIDTH - total) / 2);
  let close = { x0: 0, x1: -1 };
  for (const hint of hints) {
    const x0 = cursor;
    cursor += paintKeycap(hint.key, cursor, HINTS_TOP, (px, py, colour) => put(px, py, colour));
    cursor += HINT_GAP;
    cursor += text(hint.label, cursor, HINTS_TOP + 2, INK);
    if (hint.label === "Close") close = { x0, x1: cursor - 1 };
    cursor += HINTS_GAP;
  }

  return { picture: { width, height, rgba }, rows, close };
}

/** What a click at a point of the screen does while the menu is open. */
export type MenuHit = "close" | "toggle" | null;

/** Canvas overlay controller for the mod menu. */
export class ModMenu {
  readonly element = document.createElement("canvas");
  private opened = false;
  private selected = 0;
  private offset = 0;
  private layout: MenuLayout | null = null;
  private paintedKey: string | null = null;
  private readonly left: number;
  private readonly top: number;

  constructor(
    screenWidth: number,
    screenHeight: number,
    private readonly registry: ModRegistry,
  ) {
    this.left = Math.round((screenWidth - MENU_WIDTH) / 2);
    this.top = Math.round((screenHeight - MENU_HEIGHT) / 2);
    const share = (v: number, total: number): string => `${(100 * v) / total}%`;
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    style.left = share(this.left, screenWidth);
    style.top = share(this.top, screenHeight);
    style.width = share(MENU_WIDTH + SHADOW, screenWidth);
    style.height = share(MENU_HEIGHT + SHADOW, screenHeight);
    this.element.width = MENU_WIDTH + SHADOW;
    this.element.height = MENU_HEIGHT + SHADOW;
    this.element.dataset.testid = "modmenu";
  }

  open(): void {
    this.opened = true;
    this.paintedKey = null;
  }

  close(): void {
    this.opened = false;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** Repaint when what it shows or its light changed; hidden while closed (`dtS` unused: it waits on no clock). */
  update(dtS: number, lamp: Rgb = DAYLIGHT): void {
    if (!this.opened) {
      this.element.style.display = "none";
      return;
    }
    const entries = this.entries();
    this.selected = Math.min(Math.max(this.selected, 0), Math.max(0, entries.length - 1));
    this.offset = scrollOffset(this.selected, this.offset, entries.length);
    const key = JSON.stringify([entries, this.selected, this.offset, lampKey(lamp)]);
    if (this.paintedKey !== key) {
      this.paintedKey = key;
      this.layout = paintModMenu(entries, this.selected, this.offset);
      const { picture } = this.layout;
      lightPicture(picture, lamp);
      this.element
        .getContext("2d")
        ?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0);
    }
    this.element.style.display = "block";
  }

  /** A key while open: `true` if the menu used it (the menu is modal for its own keys). */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.opened) return false;
    const count = this.registry.getMods().length;
    switch (e.key) {
      case "ArrowUp":
        if (count > 0) this.selected = (this.selected - 1 + count) % count;
        return true;
      case "ArrowDown":
        if (count > 0) this.selected = (this.selected + 1) % count;
        return true;
      case " ":
      case "Enter":
        this.toggleSelected();
        return true;
      case "Escape":
      case "m":
      case "M":
        this.close();
        return true;
      case "Tab":
        return true;
      default:
        return false;
    }
  }

  /** What a click at art pixel (artX, artY) of the screen would do. */
  hitAt(artX: number, artY: number): MenuHit {
    const x = artX - this.left;
    const y = artY - this.top;
    if (x < 0 || y < 0 || x >= MENU_WIDTH || y >= MENU_HEIGHT) return "close";
    if (this.rowAt(x, y) !== null) return "toggle";
    const close = this.layout?.close;
    if (close !== undefined && y >= HINTS_TOP && y < HINTS_TOP + 11) {
      if (x >= close.x0 && x <= close.x1) return "close";
    }
    return null;
  }

  /** Act on a click while open: a row is selected and toggled, outside or `Close` closes. */
  handlePointer(artX: number, artY: number): boolean {
    if (!this.opened) return false;
    const hit = this.hitAt(artX, artY);
    if (hit === "close") {
      this.close();
    } else if (hit === "toggle") {
      const row = this.rowAt(artX - this.left, artY - this.top);
      if (row !== null) {
        this.selected = row;
        this.toggleSelected();
      }
    }
    return true;
  }

  private rowAt(x: number, y: number): number | null {
    if (x < LIST_LEFT || x > LIST_RIGHT) return null;
    const row = this.layout?.rows.find((r) => y >= r.y0 && y <= r.y1);
    return row === undefined ? null : row.index;
  }

  private toggleSelected(): void {
    const mod = this.registry.getMods()[this.selected];
    if (mod !== undefined) this.registry.toggleMod(mod.meta.id);
  }

  private entries(): MenuEntry[] {
    return this.registry.getMods().map((mod) => ({
      name: mod.meta.name,
      version: mod.meta.version,
      ...(mod.meta.author === undefined ? {} : { author: mod.meta.author }),
      description: mod.meta.description,
      enabled: this.registry.isModEnabled(mod.meta.id),
    }));
  }
}
