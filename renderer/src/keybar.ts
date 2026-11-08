/**
 * Bottom-right whisper key hint bar for Lineage-Smerdino (`512x300` art pixels).
 *
 * Painted pixel-by-pixel in the same wooden frame, cream card and bitmap font as `card.ts`,
 * lit by `lantern` (`captions.ts`) so that at night in a dark bedroom it warms and dims like
 * candlelight instead of glaring. By default (`keyBarMode === "auto"`) it shows on wake or
 * interaction and slides softly out of sight after 10 seconds, leaving the island pure.
 */
import {
  DAYLIGHT,
  INK,
  SHADOW_ALPHA,
  SHADOW_COLOUR,
  lampKey,
  lightPicture,
  type Picture,
} from "./captions";
import type { Rgb } from "./atmosphere/light";
import { SUNLIT } from "./palette";
import { draw, measure } from "./pixelfont";
import type { KeyBarMode } from "./settings";

/** Seconds the bar stays out after activity in `"auto"` mode, and slide duration. */
export const KEYBAR_IDLE_S = 10;
export const KEYBAR_SLEEP_IDLE_S = 3;
export const KEYBAR_SLIDE_S = 0.35;

/** Colours matching `card.ts`. */
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const FRAME_SHADE = 0x6b3f22;
const CARD = 0xfaf3e1;
const CARD_SHADE = 0xe7dabd;
const KEY_BG = 0xf3e6c8;
const KEY_SHADE = 0xd4be94;
const KEY_BORDER = 0x8a6544;
const WORD_INK = 0x4a2c26;
const READY_DOT = 0x6fb03a;
const READY_DOT_LIT = 0xc8e88a;
const COOLDOWN_DOT = 0xb59e78;
const MOON_OFF = 0x7a6855;
const MOON_ON = 0xe8b44c;

const MOON_BITMAP = ["..##.", ".##..", ".##..", ".##..", "..##."] as const;
const FULL_OFF_BITMAP = ["##.##", "#...#", ".....", "#...#", "##.##"] as const;
const FULL_ON_BITMAP = [".#.#.", "##.##", ".....", "##.##", ".#.#."] as const;

/** Pixel arrow glyphs (11x7) for keycaps so no character outside `pixelfont.ts` is needed. */
export const ARROW_BITMAPS = {
  upDown: [
    "..#........",
    ".###.......",
    "#.#.#...#..",
    "..#.....#..",
    "..#...#.#.#",
    ".......###.",
    "........#..",
  ],
  leftRight: [
    "..#........",
    ".#......#..",
    "#####....#.",
    ".#....#####",
    "..#......#.",
    "........#..",
    "...........",
  ],
} as const;

export type KeyGlyph =
  { kind: "text"; text: string } | { kind: "arrows"; arrows: keyof typeof ARROW_BITMAPS };

export interface KeyHint {
  id: string;
  key: KeyGlyph;
  label: string;
  /** Optional status gem, crescent moon, or fullscreen corner glyph beside the label. */
  dot?: "ready" | "cooldown" | "moon-off" | "moon-on" | "full-off" | "full-on";
}

export type GuideTab = "species" | "lineage" | "island";

/** Context-sensitive hints for the current screen state. */
export function hintsForState(
  guideOpen: boolean,
  tab: GuideTab,
  miracleDot?: "ready" | "cooldown",
  sleepMode = false,
  fullscreen = false,
): KeyHint[] {
  if (!guideOpen) {
    return [
      { id: "view", key: { kind: "text", text: "V" }, label: "View" },
      { id: "guide", key: { kind: "text", text: "Tab" }, label: "Guide" },
      {
        id: "night",
        key: { kind: "text", text: "N" },
        label: "Night",
        dot: sleepMode ? "moon-on" : "moon-off",
      },
      {
        id: "miracle",
        key: { kind: "text", text: "G" },
        label: "Miracle",
        ...(miracleDot === undefined ? {} : { dot: miracleDot }),
      },
      {
        id: "fullscreen",
        key: { kind: "text", text: "F" },
        label: "Full",
        dot: fullscreen ? "full-on" : "full-off",
      },
    ];
  }
  if (tab === "species") {
    return [
      { id: "tabs", key: { kind: "text", text: "1-3" }, label: "Page" },
      { id: "select", key: { kind: "arrows", arrows: "upDown" }, label: "Species" },
      { id: "follow", key: { kind: "text", text: "Enter" }, label: "Follow" },
      { id: "close", key: { kind: "text", text: "Esc" }, label: "Close" },
    ];
  }
  if (tab === "lineage") {
    return [
      { id: "tabs", key: { kind: "text", text: "1-3" }, label: "Page" },
      { id: "scroll", key: { kind: "arrows", arrows: "upDown" }, label: "Scroll" },
      { id: "follow", key: { kind: "text", text: "Enter" }, label: "Follow" },
      { id: "close", key: { kind: "text", text: "Esc" }, label: "Close" },
    ];
  }
  return [
    { id: "tabs", key: { kind: "text", text: "1-3" }, label: "Page" },
    { id: "select", key: { kind: "arrows", arrows: "upDown" }, label: "Row" },
    { id: "adjust", key: { kind: "arrows", arrows: "leftRight" }, label: "Set" },
    {
      id: "miracle",
      key: { kind: "text", text: "G" },
      label: "Miracle",
      ...(miracleDot === undefined ? {} : { dot: miracleDot }),
    },
    { id: "close", key: { kind: "text", text: "Esc" }, label: "Close" },
  ];
}

const FRAME = 2;
const PAD_X = 4;
const PAD_Y = 2;
const KEY_PAD_X = 3;
const KEY_HEIGHT = 11;
const LABEL_GAP = 3;
const ITEM_GAP = 6;
const DOT_GAP = 3;
const DOT_SIZE = 4;
const SHADOW = 1;

function glyphInnerWidth(glyph: KeyGlyph): number {
  if (glyph.kind === "arrows") return ARROW_BITMAPS[glyph.arrows][0]?.length ?? 11;
  return measure(glyph.text);
}

/** Width in art pixels of a single beveled keycap. */
export function keycapWidth(glyph: KeyGlyph): number {
  return glyphInnerWidth(glyph) + 2 * KEY_PAD_X + 2;
}

/** Paint a beveled pixel-art keycap at `(x, y)` (`height = 11` art pixels). */
export function paintKeycap(
  glyph: KeyGlyph,
  x: number,
  y: number,
  put: (px: number, py: number, colour: number) => void,
): number {
  const w = keycapWidth(glyph);
  const h = KEY_HEIGHT;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const corner = (r === 0 || r === h - 1) && (c === 0 || c === w - 1);
      if (corner) continue;
      const border = r === 0 || r === h - 1 || c === 0 || c === w - 1;
      if (border) {
        put(x + c, y + r, KEY_BORDER);
      } else if (r === 1) {
        put(x + c, y + r, SUNLIT);
      } else if (r === h - 2) {
        put(x + c, y + r, KEY_SHADE);
      } else {
        put(x + c, y + r, KEY_BG);
      }
    }
  }
  const gx = x + 1 + KEY_PAD_X;
  const gy = y + 2;
  if (glyph.kind === "text") {
    draw(glyph.text, gx, gy, (px, py) => put(px, py, INK));
  } else {
    const rows = ARROW_BITMAPS[glyph.arrows];
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === "#") put(gx + c, gy + r, INK);
      });
    });
  }
  return w;
}

function hintWidth(hint: KeyHint): number {
  const base = keycapWidth(hint.key) + LABEL_GAP + measure(hint.label);
  if (hint.dot === undefined) return base;
  const is5px =
    hint.dot === "moon-off" ||
    hint.dot === "moon-on" ||
    hint.dot === "full-off" ||
    hint.dot === "full-on";
  return base + DOT_GAP + (is5px ? 5 : DOT_SIZE);
}

/** Size of the painted key hint strip in art pixels, shadow included. */
export function keyBarSize(hints: readonly KeyHint[]): { width: number; height: number } {
  const itemsWidth =
    hints.reduce((sum, h) => sum + hintWidth(h), 0) + Math.max(0, hints.length - 1) * ITEM_GAP;
  return {
    width: 2 * FRAME + 2 * PAD_X + itemsWidth + SHADOW,
    height: 2 * FRAME + 2 * PAD_Y + KEY_HEIGHT + SHADOW,
  };
}

/** Pure pixel painter for the bottom-right key hint strip. */
export function paintKeyBar(hints: readonly KeyHint[]): {
  picture: Picture;
  boxes: { id: string; x0: number; x1: number }[];
} {
  const { width, height } = keyBarSize(hints);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, colour: number, alpha = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (y * width + x);
    rgba[at] = (colour >> 16) & 255;
    rgba[at + 1] = (colour >> 8) & 255;
    rgba[at + 2] = colour & 255;
    rgba[at + 3] = alpha;
  };
  const outerW = width - SHADOW;
  const outerH = height - SHADOW;

  for (let y = SHADOW; y < height; y++) {
    for (let x = SHADOW; x < width; x++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  }

  for (let y = 0; y < outerH; y++) {
    for (let x = 0; x < outerW; x++) {
      const ring = Math.min(x, y, outerW - 1 - x, outerH - 1 - y);
      if (ring === 0) put(x, y, FRAME_EDGE);
      else if (ring === 1) put(x, y, Math.min(x, y) === 1 ? FRAME_LIT : FRAME_SHADE);
      else put(x, y, x === FRAME || y === FRAME ? CARD_SHADE : CARD);
    }
  }

  let cursor = FRAME + PAD_X;
  const top = FRAME + PAD_Y;
  const boxes: { id: string; x0: number; x1: number }[] = [];

  for (const hint of hints) {
    const startX = cursor;
    const kw = paintKeycap(hint.key, cursor, top, (px, py, col) => put(px, py, col));
    cursor += kw + LABEL_GAP;
    cursor += draw(hint.label, cursor, top + 2, (px, py) => put(px, py, WORD_INK));
    if (hint.dot !== undefined) {
      cursor += DOT_GAP;
      if (
        hint.dot === "moon-off" ||
        hint.dot === "moon-on" ||
        hint.dot === "full-off" ||
        hint.dot === "full-on"
      ) {
        const iconCol = hint.dot === "moon-on" || hint.dot === "full-on" ? MOON_ON : MOON_OFF;
        const bitmap =
          hint.dot === "full-on"
            ? FULL_ON_BITMAP
            : hint.dot === "full-off"
              ? FULL_OFF_BITMAP
              : MOON_BITMAP;
        const my = top + 3;
        bitmap.forEach((row, r) => {
          [...row].forEach((ch, c) => {
            if (ch === "#") put(cursor + c, my + r, iconCol);
          });
        });
        cursor += 5;
      } else {
        const dy = top + 4;
        const fill = hint.dot === "ready" ? READY_DOT : COOLDOWN_DOT;
        for (let r = 0; r < DOT_SIZE; r++) {
          for (let c = 0; c < DOT_SIZE; c++) {
            const corner = (r === 0 || r === DOT_SIZE - 1) && (c === 0 || c === DOT_SIZE - 1);
            if (corner) continue;
            const lit = hint.dot === "ready" && r === 1 && c === 1;
            put(cursor + c, dy + r, lit ? READY_DOT_LIT : fill);
          }
        }
        cursor += DOT_SIZE;
      }
    }
    boxes.push({ id: hint.id, x0: startX, x1: cursor });
    cursor += ITEM_GAP;
  }

  return { picture: { width, height, rgba }, boxes };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

const RIGHT_MARGIN = 6;
const BOTTOM_MARGIN = 4;

/** Canvas overlay controller for the bottom-right key hint strip. */
export class KeyBar {
  readonly element = document.createElement("canvas");
  private idleS = 0;
  private progress = 1;
  private boxes: { id: string; x0: number; x1: number }[] = [];
  private lastLeft = 0;
  private lastTop = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private paintedKey: string | null = null;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    this.element.dataset.testid = "keybar";
  }

  /** Note user activity so `"auto"` mode reveals the bar again. */
  wake(): void {
    this.idleS = 0;
  }

  /** Hit-test an art-pixel click `(artX, artY)`; returns the clicked hint `id` or null. */
  hitAt(artX: number, artY: number): string | null {
    if (this.progress <= 0.5) return null;
    const localX = artX - this.lastLeft;
    const localY = artY - this.lastTop;
    if (localX < 0 || localY < 0 || localX >= this.lastWidth || localY >= this.lastHeight) {
      return null;
    }
    for (const box of this.boxes) {
      if (localX >= box.x0 - 2 && localX <= box.x1 + 2) return box.id;
    }
    return null;
  }

  get visible(): boolean {
    return this.progress > 0;
  }

  update(
    dtS: number,
    options: {
      mode: KeyBarMode;
      guideOpen: boolean;
      tab: GuideTab;
      miracleDot?: "ready" | "cooldown";
      sleepMode?: boolean;
      fullscreen?: boolean;
      scrollShowing: boolean;
      lamp?: Rgb;
    },
  ): void {
    this.idleS += dtS;
    const {
      mode,
      guideOpen,
      tab,
      miracleDot,
      sleepMode = false,
      fullscreen = false,
      scrollShowing,
      lamp = DAYLIGHT,
    } = options;
    const idleLimit = sleepMode ? KEYBAR_SLEEP_IDLE_S : KEYBAR_IDLE_S;
    const shouldShow =
      mode === "hidden"
        ? false
        : guideOpen
          ? true
          : !scrollShowing && (mode === "always" || this.idleS < idleLimit);

    if (shouldShow) {
      this.progress = Math.min(1, this.progress + dtS / KEYBAR_SLIDE_S);
    } else {
      this.progress = Math.max(0, this.progress - dtS / KEYBAR_SLIDE_S);
    }

    const open = smooth(this.progress);
    if (open <= 0) {
      this.element.style.display = "none";
      this.paintedKey = null;
      return;
    }

    const hints = hintsForState(guideOpen, tab, miracleDot, sleepMode, fullscreen);
    const key = JSON.stringify([hints, lampKey(lamp)]);
    const share = (v: number, total: number): string => `${(100 * v) / total}%`;

    if (this.paintedKey !== key) {
      this.paintedKey = key;
      const { picture, boxes } = paintKeyBar(hints);
      lightPicture(picture, lamp);
      this.boxes = boxes;
      this.lastWidth = picture.width;
      this.lastHeight = picture.height;
      if (this.element.width !== picture.width || this.element.height !== picture.height) {
        this.element.width = picture.width;
        this.element.height = picture.height;
        this.element.style.width = share(picture.width, this.screenWidth);
        this.element.style.height = share(picture.height, this.screenHeight);
      }
      this.element
        .getContext("2d")
        ?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0);
    }

    const left = guideOpen
      ? Math.round((this.screenWidth - this.lastWidth) / 2)
      : this.screenWidth - RIGHT_MARGIN - this.lastWidth;
    const restingTop = this.screenHeight - BOTTOM_MARGIN - this.lastHeight;
    const hiddenTop = this.screenHeight + 2;
    const top = Math.round(hiddenTop + (restingTop - hiddenTop) * open);

    if (left !== this.lastLeft) {
      this.lastLeft = left;
      this.element.style.left = share(left, this.screenWidth);
    }
    if (top !== this.lastTop) {
      this.lastTop = top;
      this.element.style.top = share(top, this.screenHeight);
    }
    this.element.style.display = "block";
  }
}
