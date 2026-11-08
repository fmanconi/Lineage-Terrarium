/**
 * The Naturalist's Field Guide (`Tab`) for Lineage: Terrarium (`512x300` art pixels).
 *
 * Rendered entirely in crisp 1x1 art pixels inside a beveled wooden cover with cream double
 * pages, sage heading band, three physical bookmarks (`1 Species`, `2 Lineage`, `3 Island`),
 * procedural creature portraits (`creatures/portrait.ts`), 7x7 trait icons (`card.ts`), and
 * warm night-time candlelight (`lightPicture` from `captions.ts`).
 */
import {
  DAYLIGHT,
  FADED_INK,
  INK,
  SHADOW_ALPHA,
  SHADOW_COLOUR,
  lampKey,
  lightPicture,
  longDate,
  type Picture,
} from "./captions";
import type { Rgb } from "./atmosphere/light";
import { ICONS, type IconName } from "./card";
import { PORTRAIT_SIZE } from "./creatures/portrait";
import type { LivingSpeciesSummary, SpeciesGuideSnapshot, SpeciesRecord } from "./herd";
import { paintKeycap, type GuideTab } from "./keybar";
import { SUNLIT } from "./palette";
import { HAND_FONT, draw, measure } from "./pixelfont";
import type { ClockMessage, SkyMessage } from "./protocol";
import { stepSetting, type TerrariumSettings } from "./settings";
import type { Pixels } from "./terrain/pixels";

/** Art-pixel dimensions of the open double-page field guide (including 2px shadow). */
export const GUIDE_OUTER_W = 480;
export const GUIDE_OUTER_H = 264;
export const GUIDE_SHADOW = 2;
export const GUIDE_WIDTH = GUIDE_OUTER_W + GUIDE_SHADOW;
export const GUIDE_HEIGHT = GUIDE_OUTER_H + GUIDE_SHADOW;

/** Open/close slide durations, and auto-close idle timeout (15 minutes, matching Director). */
export const GUIDE_IN_S = 0.35;
export const GUIDE_OUT_S = 0.28;
export const GUIDE_IDLE_S = 15 * 60;

/** Palette shared with `card.ts` and `captions.ts`. */
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const FRAME_WOOD = 0x9a6236;
const FRAME_SHADE = 0x6b3f22;
const CARD = 0xfaf3e1;
const CARD_SHADE = 0xe7dabd;
const SPINE_DARK = 0xc4b08a;
const BAND = 0x5b8259;
const BAND_LIT = 0x7ca372;
const BAND_DIM = 0x486947;
const BAND_RULE = 0x3b5a3f;
const BAND_NOTE = 0xdbe8cf;
const PLATE_WASH = 0xe5ebd0;
const PLATE_ACTIVE = 0xdce6be;
const PLATE_EDGE = 0xae9c74;
const SELECT_EDGE = 0x5b8259;
const WORD_INK = 0x4a2c26;
const RULE = 0xe2d3b3;
const TRACK_BG = 0xe7dabd;

const GRAZER_COL = 0x679e42;
const OMNI_COL = 0xd4943a;
const HUNTER_COL = 0xc8523b;
const WATER_COL = 0x4f8fd0;
const STEEL_COL = 0x7b858e;
const SENSE_COL = 0x8e6bb0;
const SUN_COL = 0xe5a93c;

/** Server `/god-power` response shape. */
export interface MiracleStatus {
  ready: boolean;
  remaining_ms: number;
  cooldown_days: number;
  needs: { rain?: number; seed?: number; ark?: number };
  closed: string[];
  solar_cycle: boolean;
  solar_elevation_deg: number;
  light: number;
  time_scale?: number;
  alternating_cycle?: boolean;
  daylight_phase?: "day" | "night";
  phase_remaining_ms?: number;
}

/** Flattened cladogram row for Tab 2 (`Lineage`). */
export interface LineageRow {
  id: number;
  name: string;
  parent: number | null;
  parentName: string | null;
  daughters: number;
  members: number;
  extinct: boolean;
  body: number | null;
  mark: number | null;
  depth: number;
  isLast: boolean;
  pipes: readonly boolean[];
}

/** Build DFS cladogram rows from `SpeciesGuideSnapshot["lineage"]`. */
export function buildLineageRows(lineage: SpeciesGuideSnapshot["lineage"]): {
  rows: LineageRow[];
  founders: number;
  maxDepth: number;
} {
  const byId = new Map<number, (typeof lineage)[number]>();
  for (const item of lineage) byId.set(item.id, item);

  const children = new Map<number | null, (typeof lineage)[number][]>();
  for (const item of lineage) {
    const parentKey = item.parent !== null && byId.has(item.parent) ? item.parent : null;
    const list = children.get(parentKey);
    if (list === undefined) children.set(parentKey, [item]);
    else list.push(item);
  }
  for (const list of children.values()) list.sort((a, b) => a.id - b.id);

  const rows: LineageRow[] = [];
  let maxDepth = 0;
  const roots = children.get(null) ?? [];

  const visit = (
    node: (typeof lineage)[number],
    depth: number,
    isLast: boolean,
    pipes: readonly boolean[],
  ): void => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children.get(node.id) ?? [];
    const parentRec = node.parent !== null ? byId.get(node.parent) : undefined;
    rows.push({
      id: node.id,
      name: node.name !== "" ? node.name : `Species ${node.id}`,
      parent: node.parent,
      parentName: parentRec?.name ?? null,
      daughters: kids.length,
      members: node.members,
      extinct: node.extinct,
      body: node.body,
      mark: node.mark,
      depth,
      isLast,
      pipes,
    });
    const nextPipes = depth === 0 ? pipes : [...pipes, !isLast];
    kids.forEach((kid, idx) => visit(kid, depth + 1, idx === kids.length - 1, nextPipes));
  };

  roots.forEach((root, idx) => visit(root, 0, idx === roots.length - 1, []));
  return { rows, founders: roots.length, maxDepth: rows.length === 0 ? 0 : maxDepth + 1 };
}

/** Interactive click region inside the painted book (in book-local art pixels). */
export interface HitZone {
  action:
    | { type: "tab"; tab: GuideTab }
    | { type: "select-species"; id: number }
    | { type: "follow-species"; id: number }
    | { type: "select-lineage"; index: number }
    | { type: "setting"; index: number; delta: -1 | 1 }
    | { type: "miracle" };
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Full input state for pure painting of the Field Guide. */
export interface FieldGuideView {
  tab: GuideTab;
  guide: SpeciesGuideSnapshot;
  selectedSpeciesId: number | null;
  lineageIndex: number;
  settingIndex: number;
  settings: TerrariumSettings;
  portrait: Pixels | null;
  clock: ClockMessage | null;
  sky: SkyMessage | null;
  miracle: MiracleStatus | null;
  miracleNote: string | null;
}

/** Truncate `text` with `..` so its pixel width never exceeds `maxPx`. */
export function fitText(text: string, maxPx: number): string {
  if (measure(text) <= maxPx) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}..`) > maxPx) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}..`;
}

function fitHandText(text: string, maxPx: number): string {
  if (HAND_FONT.measure(text) <= maxPx) return text;
  let cut = text;
  while (cut.length > 1 && HAND_FONT.measure(`${cut}..`) > maxPx) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}..`;
}

/** Format remaining cooldown milliseconds as e.g. `"5d 14h"` or `"42m"`. */
export function formatCooldown(ms: number): string {
  if (ms <= 0) return "Ready";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const FRAME = 4;
const HEADER_TOP = FRAME;
const HEADER_H = 17;
const PAGE_TOP = HEADER_TOP + HEADER_H;
const PAGE_BOTTOM = GUIDE_OUTER_H - FRAME;
const SPINE_X = Math.floor(GUIDE_OUTER_W / 2);

const LEFT_X0 = FRAME + 8;
const LEFT_X1 = SPINE_X - 8;
const RIGHT_X0 = SPINE_X + 8;
const RIGHT_X1 = GUIDE_OUTER_W - FRAME - 8;

const SPECIES_PER_PAGE = 9;
const LINEAGE_PER_COL = 9;
const LINEAGE_PER_SPREAD = LINEAGE_PER_COL * 2;

const DAGGER_ROWS = ["..#..", "#####", "..#..", "..#..", "..#..", "....."];
const POINTER_ROWS = ["#..", "##.", "###", "##.", "#.."];
const LEFT_ARROW_SMALL = ["..#", ".##", "###", ".##", "..#"];
const RIGHT_ARROW_SMALL = ["#..", "##.", "###", "##.", "#.."];

/** Pure pixel-art painter for the open double-page Field Guide. */
export function paintFieldGuide(view: FieldGuideView): { picture: Picture; zones: HitZone[] } {
  const width = GUIDE_WIDTH;
  const height = GUIDE_HEIGHT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const zones: HitZone[] = [];

  const put = (x: number, y: number, colour: number, alpha = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (y * width + x);
    rgba[at] = (colour >> 16) & 255;
    rgba[at + 1] = (colour >> 8) & 255;
    rgba[at + 2] = colour & 255;
    rgba[at + 3] = alpha;
  };

  const rect = (x0: number, y0: number, x1: number, y1: number, colour: number): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, colour);
  };

  const box = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fill: number,
    border: number,
  ): void => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1;
        put(x, y, edge ? border : fill);
      }
    }
  };

  const hrule = (x0: number, x1: number, y: number, colour = RULE): void => {
    for (let x = x0; x < x1; x++) put(x, y, colour);
  };

  const text = (str: string, x: number, y: number, colour = WORD_INK): number =>
    draw(str, x, y, (px, py) => put(px, py, colour));

  const rightText = (str: string, rightX: number, y: number, colour = WORD_INK): void => {
    const w = measure(str);
    text(str, rightX - w, y, colour);
  };

  const bitmap = (rows: readonly string[], x: number, y: number, colour: number): void => {
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === "#") put(x + c, y + r, colour);
      });
    });
  };

  const icon7 = (name: IconName, x: number, y: number): void => {
    const def = ICONS[name];
    const palette: Readonly<Record<string, number>> = def.colours;
    def.rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        const col = palette[ch];
        if (col !== undefined) put(x + c, y + r, col);
      });
    });
  };

  const gauge = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    share: number,
    fill: number,
  ): void => {
    box(x0, y0, x0 + w, y0 + h, TRACK_BG, PLATE_EDGE);
    const inner = Math.max(0, w - 2);
    const filled = Math.round(inner * Math.min(Math.max(share, 0), 1));
    const lit = lighten(fill, 0.22);
    for (let y = y0 + 1; y < y0 + h - 1; y++) {
      const c = y === y0 + 1 ? lit : fill;
      for (let x = 0; x < filled; x++) put(x0 + 1 + x, y, c);
    }
  };

  const swatch = (x: number, y: number, w: number, h: number, body: number, mark: number): void => {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const edge = r === 0 || r === h - 1 || c === 0 || c === w - 1;
        if (edge) {
          put(x + c, y + r, FRAME_EDGE);
        } else {
          const isMark = c + r >= Math.floor((w + h) * 0.58);
          put(x + c, y + r, isMark ? mark : body);
        }
      }
    }
  };

  // 1. Drop shadow
  for (let y = GUIDE_SHADOW; y < height; y++) {
    for (let x = GUIDE_SHADOW; x < width; x++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  }

  // 2. Beveled wooden cover
  for (let y = 0; y < GUIDE_OUTER_H; y++) {
    for (let x = 0; x < GUIDE_OUTER_W; x++) {
      const ring = Math.min(x, y, GUIDE_OUTER_W - 1 - x, GUIDE_OUTER_H - 1 - y);
      if (ring >= FRAME) continue;
      if (ring === 0) put(x, y, FRAME_EDGE);
      else if (ring < FRAME - 1) put(x, y, Math.min(x, y) === ring ? FRAME_LIT : FRAME_SHADE);
      else put(x, y, FRAME_WOOD);
    }
  }

  // 3. Double cream pages and central book spine
  for (let y = PAGE_TOP; y < PAGE_BOTTOM; y++) {
    for (let x = FRAME; x < GUIDE_OUTER_W - FRAME; x++) {
      const distSpine = Math.abs(x - SPINE_X);
      let col = CARD;
      if (x === FRAME || x === GUIDE_OUTER_W - FRAME - 1 || y === PAGE_TOP) col = CARD_SHADE;
      if (distSpine === 0) col = SPINE_DARK;
      else if (distSpine <= 2) col = CARD_SHADE;
      put(x, y, col);
    }
  }

  // 4. Sage heading band and 3 physical bookmark tabs
  for (let y = HEADER_TOP; y < PAGE_TOP; y++) {
    const row = y - HEADER_TOP;
    const col = row === 0 ? BAND_LIT : row === HEADER_H - 1 ? BAND_RULE : BAND;
    for (let x = FRAME; x < GUIDE_OUTER_W - FRAME; x++) put(x, y, col);
  }

  text("FIELD GUIDE", LEFT_X0, HEADER_TOP + 5, SUNLIT);
  if (view.clock !== null) {
    const seasonLabel = view.clock.season.charAt(0).toUpperCase() + view.clock.season.slice(1);
    const dateStr = `${longDate(view.clock.date)} - ${seasonLabel}`;
    text(fitText(dateStr, 145), LEFT_X0 + 68, HEADER_TOP + 5, BAND_NOTE);
  }

  const tabs: { id: GuideTab; label: string }[] = [
    { id: "species", label: "1 Species" },
    { id: "lineage", label: "2 Lineage" },
    { id: "island", label: "3 Island" },
  ];
  let tabX = RIGHT_X0 + 6;
  for (const t of tabs) {
    const tw = measure(t.label) + 12;
    const active = view.tab === t.id;
    const ty0 = HEADER_TOP + 3;
    const ty1 = active ? PAGE_TOP + 1 : PAGE_TOP - 1;
    for (let y = ty0; y < ty1; y++) {
      for (let x = tabX; x < tabX + tw; x++) {
        const topOrSide = y === ty0 || x === tabX || x === tabX + tw - 1;
        if (active) {
          put(x, y, topOrSide ? BAND_RULE : CARD);
        } else {
          put(x, y, topOrSide ? BAND_RULE : BAND_DIM);
        }
      }
    }
    text(t.label, tabX + 6, HEADER_TOP + 6, active ? INK : SUNLIT);
    zones.push({
      action: { type: "tab", tab: t.id },
      x0: tabX,
      y0: ty0,
      x1: tabX + tw,
      y1: PAGE_TOP,
    });
    tabX += tw + 4;
  }

  // 5. Active spread contents
  if (view.tab === "species") {
    paintSpeciesSpread(view, {
      put,
      rect,
      box,
      hrule,
      text,
      rightText,
      bitmap,
      icon7,
      gauge,
      swatch,
      zones,
    });
  } else if (view.tab === "lineage") {
    paintLineageSpread(view, {
      put,
      box,
      hrule,
      text,
      rightText,
      bitmap,
      swatch,
      zones,
    });
  } else {
    paintIslandSpread(view, {
      put,
      box,
      hrule,
      text,
      rightText,
      bitmap,
      gauge,
      zones,
    });
  }

  return { picture: { width, height, rgba }, zones };
}

interface DrawHelpers {
  put: (x: number, y: number, colour: number, alpha?: number) => void;
  rect: (x0: number, y0: number, x1: number, y1: number, colour: number) => void;
  box: (x0: number, y0: number, x1: number, y1: number, fill: number, border: number) => void;
  hrule: (x0: number, x1: number, y: number, colour?: number) => void;
  text: (str: string, x: number, y: number, colour?: number) => number;
  rightText: (str: string, rightX: number, y: number, colour?: number) => void;
  bitmap: (rows: readonly string[], x: number, y: number, colour: number) => void;
  icon7: (name: IconName, x: number, y: number) => void;
  gauge: (x0: number, y0: number, w: number, h: number, share: number, fill: number) => void;
  swatch: (x: number, y: number, w: number, h: number, body: number, mark: number) => void;
  zones: HitZone[];
}

function paintSpeciesSpread(view: FieldGuideView, h: DrawHelpers): void {
  const { guide } = view;
  const { living } = guide;

  // Left Page: Census box
  h.box(LEFT_X0, 26, LEFT_X1, 51, PLATE_WASH, PLATE_EDGE);
  h.text(`Living: ${guide.livingSpeciesCount} sp. (${guide.totalCreatures})`, LEFT_X0 + 5, 29, INK);
  if (guide.extinctSpeciesCount > 0) {
    h.rightText(`+${guide.extinctSpeciesCount} ext.`, LEFT_X1 - 5, 29, FADED_INK);
  }
  h.text(`G:${guide.grazers} O:${guide.omnivores} H:${guide.hunters}`, LEFT_X0 + 5, 40, WORD_INK);

  // 3-segment diet bar
  const barX = LEFT_X0 + 118;
  const barW = LEFT_X1 - 5 - barX;
  h.box(barX, 41, barX + barW, 47, TRACK_BG, PLATE_EDGE);
  if (guide.totalCreatures > 0 && barW > 2) {
    const inner = barW - 2;
    const gW = Math.round((inner * guide.grazers) / guide.totalCreatures);
    const oW = Math.round((inner * guide.omnivores) / guide.totalCreatures);
    for (let y = 42; y < 46; y++) {
      for (let x = 0; x < inner; x++) {
        const col = x < gW ? GRAZER_COL : x < gW + oW ? OMNI_COL : HUNTER_COL;
        h.put(barX + 1 + x, y, col);
      }
    }
  }

  if (living.length === 0) {
    h.text("No creatures walk the island yet.", LEFT_X0 + 18, 128, FADED_INK);
    h.text("Wait for founders from the sea.", RIGHT_X0 + 22, 128, FADED_INK);
    return;
  }

  const selectedIdx = Math.max(
    0,
    living.findIndex((sp) => sp.id === view.selectedSpeciesId),
  );
  const selected = living[selectedIdx] ?? living[0];
  if (selected === undefined) return;

  const maxStart = Math.max(0, living.length - SPECIES_PER_PAGE);
  const start = Math.min(maxStart, Math.max(0, selectedIdx - Math.floor(SPECIES_PER_PAGE / 2)));
  const maxMembers = Math.max(1, ...living.map((s) => s.members));

  const listTop = 55;
  const rowH = 20;
  for (let slot = 0; slot < SPECIES_PER_PAGE; slot++) {
    const sp = living[start + slot];
    if (sp === undefined) break;
    const y0 = listTop + slot * rowH;
    const isSel = sp.id === selected.id;
    if (isSel) {
      h.box(LEFT_X0, y0, LEFT_X1, y0 + rowH - 1, PLATE_ACTIVE, SELECT_EDGE);
      h.bitmap(POINTER_ROWS, LEFT_X0 + 3, y0 + 7, SELECT_EDGE);
    } else {
      h.hrule(LEFT_X0 + 2, LEFT_X1 - 2, y0 + rowH - 2, RULE);
    }
    h.swatch(LEFT_X0 + 8, y0 + 3, 8, 12, sp.body, sp.mark);
    const countStr = String(sp.members);
    const nameMax = LEFT_X1 - LEFT_X0 - 30 - measure(countStr);
    h.text(fitText(sp.name, nameMax), LEFT_X0 + 20, y0 + 2, INK);
    h.rightText(countStr, LEFT_X1 - 5, y0 + 2, isSel ? INK : WORD_INK);

    // Mini population share bar + up to 5 adaptation icons
    const popW = 86;
    h.box(LEFT_X0 + 20, y0 + 12, LEFT_X0 + 20 + popW, y0 + 16, TRACK_BG, PLATE_EDGE);
    const fillW = Math.max(1, Math.round(((popW - 2) * sp.members) / maxMembers));
    h.rect(LEFT_X0 + 21, y0 + 13, LEFT_X0 + 21 + fillW, y0 + 15, sp.body);

    let ix = LEFT_X0 + 20 + popW + 6;
    for (const ic of sp.icons.slice(0, 5)) {
      if (ix + 7 > LEFT_X1 - 4) break;
      h.icon7(ic, ix, y0 + 10);
      ix += 9;
    }

    h.zones.push({
      action: { type: "select-species", id: sp.id },
      x0: LEFT_X0,
      y0,
      x1: LEFT_X1,
      y1: y0 + rowH - 1,
    });
  }

  h.text(`Species ${selectedIdx + 1} of ${living.length}`, LEFT_X0 + 2, 241, FADED_INK);
  if (living.length > SPECIES_PER_PAGE) {
    h.rightText(
      `${start + 1}-${Math.min(living.length, start + SPECIES_PER_PAGE)}`,
      LEFT_X1 - 2,
      241,
      FADED_INK,
    );
  }

  // Right Page: Anatomical Plate of `selected`
  const parentRec =
    selected.parent !== null ? guide.lineage.find((r) => r.id === selected.parent) : undefined;
  const originStr =
    selected.parent === null
      ? "Founder"
      : `from ${fitText(parentRec?.name ?? `Sp.${selected.parent}`, 64)}`;
  h.rightText(originStr, RIGHT_X1, 28, FADED_INK);

  const titleMax = RIGHT_X1 - RIGHT_X0 - measure(originStr) - 8;
  HAND_FONT.draw(fitHandText(selected.name, titleMax), RIGHT_X0, 25, (px, py) =>
    h.put(px, py, INK),
  );
  h.hrule(RIGHT_X0, RIGHT_X1, 39, selected.body);

  // Portrait box (50x50)
  const plateX = RIGHT_X0;
  const plateY = 43;
  const plateSize = PORTRAIT_SIZE + 6;
  h.box(plateX, plateY, plateX + plateSize, plateY + plateSize, PLATE_WASH, PLATE_EDGE);
  if (view.portrait !== null && view.portrait.width > 0) {
    const ox = plateX + 3;
    const oy = plateY + 3;
    const { portrait } = view;
    for (let y = 0; y < Math.min(portrait.height, PORTRAIT_SIZE); y++) {
      for (let x = 0; x < Math.min(portrait.width, PORTRAIT_SIZE); x++) {
        const from = 4 * (y * portrait.width + x);
        const a = portrait.rgba[from + 3] ?? 0;
        if (a === 0) continue;
        const r = portrait.rgba[from] ?? 0;
        const g = portrait.rgba[from + 1] ?? 0;
        const b = portrait.rgba[from + 2] ?? 0;
        if (a === 255) {
          h.put(ox + x, oy + y, (r << 16) | (g << 8) | b);
        } else {
          const share = a / 255;
          const ur = (PLATE_WASH >> 16) & 255;
          const ug = (PLATE_WASH >> 8) & 255;
          const ub = PLATE_WASH & 255;
          const mr = Math.round(ur + (r - ur) * share);
          const mg = Math.round(ug + (g - ug) * share);
          const mb = Math.round(ub + (b - ub) * share);
          h.put(ox + x, oy + y, (mr << 16) | (mg << 8) | mb);
        }
      }
    }
  } else {
    h.swatch(plateX + 17, plateY + 17, 16, 16, selected.body, selected.mark);
  }

  // Naturalist notes beside portrait
  const notesX = plateX + plateSize + 7;
  const notesW = RIGHT_X1 - notesX;
  h.text(fitText(selected.traits, notesW), notesX, 45, INK);
  h.hrule(notesX, RIGHT_X1, 54, RULE);
  const adults = selected.members - selected.young;
  const awake = selected.members - selected.torpid;
  h.text(`Adults: ${adults}  Young: ${selected.young}`, notesX, 58, WORD_INK);
  h.text(`Awake: ${awake}  Sleep: ${selected.torpid}`, notesX, 69, WORD_INK);
  h.text(`Graze: ${selected.grazing}  Feed: ${selected.feeding}`, notesX, 80, WORD_INK);

  // 6 Mean Genome Gauges
  const dietColour =
    selected.dietClass === "grazer"
      ? GRAZER_COL
      : selected.dietClass === "hunter"
        ? HUNTER_COL
        : OMNI_COL;
  const traits: { label: string; value: number; col: number }[] = [
    { label: "Size", value: selected.bars.size, col: selected.body },
    { label: "Diet", value: selected.bars.diet, col: dietColour },
    { label: "Speed", value: selected.bars.speed, col: OMNI_COL },
    { label: "Armour", value: selected.bars.armour, col: STEEL_COL },
    { label: "Water", value: selected.bars.aquatic, col: WATER_COL },
    { label: "Sense", value: selected.bars.sense, col: SENSE_COL },
  ];
  traits.forEach((tr, idx) => {
    const ty = 98 + idx * 13;
    h.text(tr.label, RIGHT_X0, ty, WORD_INK);
    h.gauge(RIGHT_X0 + 44, ty + 1, 134, 6, tr.value, tr.col);
    h.rightText(`${Math.round(tr.value * 100)}%`, RIGHT_X1, ty, FADED_INK);
  });

  // Adaptations & Rare Genes
  h.hrule(RIGHT_X0, RIGHT_X1, 179, RULE);
  const badgeItems: { icon: IconName; text: string }[] = [];
  if (selected.icons.includes("water")) {
    badgeItems.push({ icon: "water", text: "Aquatic" });
  }
  for (const rc of selected.rareCounts) {
    if (Object.hasOwn(ICONS, rc.signature)) {
      const label = rc.name.charAt(0).toUpperCase() + rc.name.slice(1);
      badgeItems.push({
        icon: rc.signature as IconName,
        text: `${label} (${rc.count})`,
      });
    }
  }

  if (badgeItems.length === 0) {
    h.text("Plain island stock (no rare genes yet)", RIGHT_X0, 184, FADED_INK);
  } else {
    badgeItems.slice(0, 6).forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = col === 0 ? RIGHT_X0 : RIGHT_X0 + 110;
      const by = 183 + row * 12;
      h.icon7(item.icon, bx, by);
      h.text(fitText(item.text, 96), bx + 10, by, WORD_INK);
    });
  }

  // Follow button at foot of Right Page
  const btnY0 = 234;
  const btnY1 = 251;
  h.box(RIGHT_X0, btnY0, RIGHT_X1, btnY1, PLATE_ACTIVE, SELECT_EDGE);
  const kw = paintKeycap({ kind: "text", text: "Enter" }, RIGHT_X0 + 6, btnY0 + 3, (px, py, c) =>
    h.put(px, py, c),
  );
  h.text("Follow living member up close", RIGHT_X0 + 11 + kw, btnY0 + 5, INK);
  h.zones.push({
    action: { type: "follow-species", id: selected.id },
    x0: RIGHT_X0,
    y0: btnY0,
    x1: RIGHT_X1,
    y1: btnY1,
  });
}

function paintLineageSpread(
  view: FieldGuideView,
  h: Pick<
    DrawHelpers,
    "put" | "box" | "hrule" | "text" | "rightText" | "bitmap" | "swatch" | "zones"
  >,
): void {
  const { rows, founders, maxDepth } = buildLineageRows(view.guide.lineage);

  h.box(LEFT_X0, 26, LEFT_X1, 50, PLATE_WASH, PLATE_EDGE);
  h.text(
    `Lineage: ${rows.length} sp. (${view.guide.livingSpeciesCount} alive, ${view.guide.extinctSpeciesCount} ext.)`,
    LEFT_X0 + 5,
    29,
    INK,
  );
  h.text(`Founders: ${founders}   Generations: ${maxDepth}`, LEFT_X0 + 5, 40, FADED_INK);

  if (rows.length === 0) {
    h.box(RIGHT_X0, 26, RIGHT_X1, 50, PLATE_WASH, PLATE_EDGE);
    h.text("Evolutionary tree awaits first species.", RIGHT_X0 + 6, 34, FADED_INK);
    h.text("No species recorded yet.", LEFT_X0 + 36, 128, FADED_INK);
    return;
  }

  const selIdx = Math.min(Math.max(view.lineageIndex, 0), rows.length - 1);
  const selected = rows[selIdx] ?? rows[0];

  // Right Page header: selected species details
  h.box(RIGHT_X0, 26, RIGHT_X1, 50, PLATE_WASH, PLATE_EDGE);
  if (selected !== undefined) {
    const status = selected.members > 0 ? `${selected.members} alive` : "Extinct";
    h.text(fitText(selected.name, 130), RIGHT_X0 + 5, 29, INK);
    h.rightText(status, RIGHT_X1 - 5, 29, selected.members > 0 ? SELECT_EDGE : FADED_INK);
    const origin =
      selected.parent === null
        ? "Island founder"
        : `Split from ${fitText(selected.parentName ?? `Sp.${selected.parent}`, 80)}`;
    h.text(
      `${origin} - ${selected.daughters} split${selected.daughters === 1 ? "" : "s"}`,
      RIGHT_X0 + 5,
      40,
      FADED_INK,
    );
  }

  const pageIndex = Math.floor(selIdx / LINEAGE_PER_SPREAD);
  const spreadStart = pageIndex * LINEAGE_PER_SPREAD;
  const rowH = 19;
  const listTop = 55;

  for (let offset = 0; offset < LINEAGE_PER_SPREAD; offset++) {
    const idx = spreadStart + offset;
    const node = rows[idx];
    if (node === undefined) break;
    const onRight = offset >= LINEAGE_PER_COL;
    const colRow = offset % LINEAGE_PER_COL;
    const x0 = onRight ? RIGHT_X0 : LEFT_X0;
    const x1 = onRight ? RIGHT_X1 : LEFT_X1;
    const y0 = listTop + colRow * rowH;
    const isSel = idx === selIdx;

    if (isSel) {
      h.box(x0, y0, x1, y0 + rowH - 1, PLATE_ACTIVE, SELECT_EDGE);
    } else {
      h.hrule(x0 + 2, x1 - 2, y0 + rowH - 2, RULE);
    }

    const cappedDepth = Math.min(node.depth, 6);
    const stepPx = 10;
    const treeBaseX = x0 + 5;
    const midY = y0 + 9;

    // Ancestor vertical pipes
    for (let d = 0; d < Math.max(0, cappedDepth - 1); d++) {
      if (node.pipes[d] === true) {
        const px = treeBaseX + d * stepPx + 3;
        for (let py = y0; py < y0 + rowH - 1; py++) h.put(px, py, FADED_INK);
      }
    }

    // Branch connector from parent
    if (cappedDepth > 0) {
      const bx = treeBaseX + (cappedDepth - 1) * stepPx + 3;
      const endY = node.isLast ? midY : y0 + rowH - 1;
      for (let py = y0; py <= endY; py++) h.put(bx, py, FADED_INK);
      for (let px = bx; px <= bx + 6; px++) h.put(px, midY, FADED_INK);
    }

    const nodeX = treeBaseX + cappedDepth * stepPx;
    if (node.members > 0 && node.body !== null && node.mark !== null) {
      h.swatch(nodeX, y0 + 5, 8, 8, node.body, node.mark);
    } else {
      h.box(nodeX, y0 + 6, nodeX + 6, y0 + 12, CARD_SHADE, FADED_INK);
      h.bitmap(DAGGER_ROWS, nodeX + 8, y0 + 6, FADED_INK);
    }

    const labelX = nodeX + (node.members > 0 ? 11 : 16);
    const countLabel = node.members > 0 ? String(node.members) : "ext.";
    const maxNameW = Math.max(24, x1 - labelX - measure(countLabel) - 8);
    h.text(fitText(node.name, maxNameW), labelX, y0 + 5, node.members > 0 ? INK : FADED_INK);
    h.rightText(countLabel, x1 - 4, y0 + 5, node.members > 0 ? SELECT_EDGE : FADED_INK);

    h.zones.push({
      action:
        isSel && node.members > 0
          ? { type: "follow-species", id: node.id }
          : { type: "select-lineage", index: idx },
      x0,
      y0,
      x1,
      y1: y0 + rowH - 1,
    });
  }

  const totalSpreads = Math.max(1, Math.ceil(rows.length / LINEAGE_PER_SPREAD));
  h.text(`Spread ${pageIndex + 1} of ${totalSpreads}`, LEFT_X0 + 2, 238, FADED_INK);
  if (selected !== undefined && selected.members > 0) {
    h.rightText("Enter: Follow alive", RIGHT_X1 - 2, 238, SELECT_EDGE);
  }
}

function paintIslandSpread(
  view: FieldGuideView,
  h: Pick<
    DrawHelpers,
    "put" | "box" | "hrule" | "text" | "rightText" | "bitmap" | "gauge" | "zones"
  >,
): void {
  const { settings, miracle, sky } = view;
  const timeScale = Math.max(1, miracle?.time_scale ?? 1);

  // Left Page: 5 Screensaver & Bedroom Controls
  HAND_FONT.draw("Screensaver & Room", LEFT_X0, 25, (px, py) => h.put(px, py, INK));
  h.text(
    timeScale > 1
      ? `Fast ${Math.round(timeScale)}x living world (press F for fullscreen)`
      : "Sacred 1:1 real-time island (zero time-cheats)",
    LEFT_X0,
    39,
    FADED_INK,
  );

  const items: { title: string; value: string; note: string }[] = [
    {
      title: "Camera Director",
      value: settings.autoTour ? "Auto-Tour" : "Rest on Map",
      note: settings.autoTour ? "Cycles map, region & close-up" : "Returns to whole map after 15m",
    },
    {
      title: "Night Dimmer",
      value: settings.sleepMode
        ? "SLEEP ON (N)"
        : settings.nightDimmer === "off"
          ? "Normal"
          : settings.nightDimmer === "soft"
            ? "Soft Dim"
            : "Dark Room",
      note: settings.sleepMode
        ? "Super dark screen now (press N to wake)"
        : settings.nightDimmer === "off"
          ? "Standard moonlit blue (press N for sleep)"
          : settings.nightDimmer === "soft"
            ? "Extra dim veil after sunset"
            : "Deep bedroom dark after sunset",
    },
    {
      title: "Key Hint Bar",
      value:
        settings.keyBarMode === "auto"
          ? "Auto 10s"
          : settings.keyBarMode === "always"
            ? "Always"
            : "Hidden",
      note:
        settings.keyBarMode === "auto"
          ? "Slides away after 10s still"
          : settings.keyBarMode === "always"
            ? "Kept in bottom-right corner"
            : "Hidden while watching island",
    },
    {
      title: "Chronicle Scrolls",
      value: settings.showCaptions ? "Shown" : "Quiet",
      note: settings.showCaptions
        ? "Unrolls notable island history"
        : "Hides bottom parchment scrolls",
    },
    {
      title: "Frame Rate Cap",
      value: `${settings.fpsCap} FPS`,
      note: settings.fpsCap === 30 ? "Silent & cool kiosk default" : "Smooth 60 Hz refresh",
    },
  ];

  const startY = 52;
  const rowH = 38;
  items.forEach((item, idx) => {
    const y0 = startY + idx * rowH;
    const isSel = idx === view.settingIndex;
    h.box(
      LEFT_X0,
      y0,
      LEFT_X1,
      y0 + rowH - 3,
      isSel ? PLATE_ACTIVE : CARD,
      isSel ? SELECT_EDGE : RULE,
    );
    h.text(item.title, LEFT_X0 + 6, y0 + 5, INK);

    const valW = measure(item.value);
    const valRight = LEFT_X1 - 12;
    const valLeft = valRight - valW;
    h.bitmap(LEFT_ARROW_SMALL, valLeft - 6, y0 + 6, isSel ? SELECT_EDGE : FADED_INK);
    h.text(item.value, valLeft, y0 + 5, isSel ? SELECT_EDGE : WORD_INK);
    h.bitmap(RIGHT_ARROW_SMALL, valRight + 3, y0 + 6, isSel ? SELECT_EDGE : FADED_INK);

    h.text(fitText(item.note, LEFT_X1 - LEFT_X0 - 12), LEFT_X0 + 6, y0 + 19, FADED_INK);

    const midX = Math.floor((LEFT_X0 + LEFT_X1) / 2);
    h.zones.push({
      action: { type: "setting", index: idx, delta: -1 },
      x0: LEFT_X0,
      y0,
      x1: midX,
      y1: y0 + rowH - 3,
    });
    h.zones.push({
      action: { type: "setting", index: idx, delta: 1 },
      x0: midX,
      y0,
      x1: LEFT_X1,
      y1: y0 + rowH - 3,
    });
  });

  // Right Page Top: Alternating Day/Night Cycle or Sky Over Pisa
  const altCycle = miracle?.alternating_cycle === true;
  HAND_FONT.draw(altCycle ? "Day & Night Cycle" : "Sky Over Pisa", RIGHT_X0, 25, (px, py) =>
    h.put(px, py, INK),
  );
  h.hrule(RIGHT_X0, RIGHT_X1, 39, RULE);

  const lightLevel = miracle?.light ?? sky?.light ?? 1;
  if (miracle !== null && altCycle) {
    const phaseWord = miracle.daylight_phase === "night" ? "Night" : "Day";
    const wallRemMs = Math.round((miracle.phase_remaining_ms ?? 0) / timeScale);
    h.text(`Cycle: ${phaseWord} (${formatCooldown(wallRemMs)} left)`, RIGHT_X0, 44, WORD_INK);
  } else if (miracle !== null && miracle.solar_cycle) {
    const sign = miracle.solar_elevation_deg >= 0 ? "+" : "";
    const phase =
      miracle.solar_elevation_deg >= 6
        ? "Day"
        : miracle.solar_elevation_deg >= -6
          ? "Twilight"
          : "Night";
    h.text(
      `Sun: ${sign}${miracle.solar_elevation_deg.toFixed(1)}° (${phase})`,
      RIGHT_X0,
      44,
      WORD_INK,
    );
  } else {
    h.text("Sun: Desk presence mode", RIGHT_X0, 44, WORD_INK);
  }
  h.rightText(`Light ${Math.round(lightLevel * 100)}%`, RIGHT_X1, 44, FADED_INK);
  h.gauge(RIGHT_X0, 56, RIGHT_X1 - RIGHT_X0, 6, lightLevel, SUN_COL);

  const rainName =
    sky === null || sky.rain === "none"
      ? "Clear sky"
      : sky.rain === "soaking"
        ? "Miracle rain"
        : sky.rain.charAt(0).toUpperCase() + sky.rain.slice(1);
  const fires = sky?.burning.length ?? 0;
  const fireNote = fires > 0 ? `  (${fires} burning)` : "";
  h.text(`Weather: ${rainName}${fireNote}`, RIGHT_X0, 68, WORD_INK);
  h.text(
    timeScale > 1
      ? `Pace: ${Math.round(timeScale)}x fast insect life (50-70m sun)`
      : "Clock: 1:1 with real calendar",
    RIGHT_X0,
    80,
    FADED_INK,
  );

  // Right Page Bottom: Island Miracle (God Power)
  h.hrule(RIGHT_X0, RIGHT_X1, 95, BAND_RULE);
  HAND_FONT.draw(timeScale > 1 ? "Island Miracle" : "Weekly Miracle", RIGHT_X0, 100, (px, py) =>
    h.put(px, py, INK),
  );
  const fullCooldownLabel =
    miracle !== null && timeScale > 1
      ? formatCooldown((miracle.cooldown_days * 86_400_000) / timeScale)
      : "7 days";
  h.text(`Once every ${fullCooldownLabel}, answer the island's need`, RIGHT_X0, 114, FADED_INK);

  const sealY0 = 126;
  const sealY1 = 162;
  if (miracle === null) {
    h.box(RIGHT_X0, sealY0, RIGHT_X1, sealY1, CARD_SHADE, PLATE_EDGE);
    h.text("Miracle seal offline (recording)", RIGHT_X0 + 8, sealY0 + 8, FADED_INK);
    h.text("Connect to live Terrarium server", RIGHT_X0 + 8, sealY0 + 20, FADED_INK);
  } else if (miracle.ready) {
    h.box(RIGHT_X0, sealY0, RIGHT_X1, sealY1, PLATE_ACTIVE, SELECT_EDGE);
    const kw = paintKeycap({ kind: "text", text: "G" }, RIGHT_X0 + 8, sealY0 + 6, (px, py, c) =>
      h.put(px, py, c),
    );
    h.text(
      timeScale > 1 ? "READY - Grant Island Miracle" : "READY - Grant Weekly Miracle",
      RIGHT_X0 + 14 + kw,
      sealY0 + 8,
      INK,
    );
    h.text(
      view.miracleNote ?? "Draws Rain, Seed, Ark or Meteor",
      RIGHT_X0 + 8,
      sealY0 + 22,
      SELECT_EDGE,
    );
    h.zones.push({
      action: { type: "miracle" },
      x0: RIGHT_X0,
      y0: sealY0,
      x1: RIGHT_X1,
      y1: sealY1,
    });
  } else {
    h.box(RIGHT_X0, sealY0, RIGHT_X1, sealY1, CARD_SHADE, PLATE_EDGE);
    h.text(
      `Cooling down: ${formatCooldown(miracle.remaining_ms / timeScale)} left`,
      RIGHT_X0 + 8,
      sealY0 + 6,
      WORD_INK,
    );
    const totalMs = Math.max(1, miracle.cooldown_days * 86_400_000);
    const charged = 1 - Math.min(1, miracle.remaining_ms / totalMs);
    h.gauge(RIGHT_X0 + 8, sealY0 + 19, RIGHT_X1 - RIGHT_X0 - 16, 6, charged, BAND);
    if (view.miracleNote !== null) {
      h.text(fitText(view.miracleNote, RIGHT_X1 - RIGHT_X0 - 16), RIGHT_X0 + 8, sealY0 + 27, INK);
    }
  }

  // Island ecological needs
  h.text("Current ecological need:", RIGHT_X0, 169, FADED_INK);
  const rainNeed = miracle?.needs.rain ?? 0;
  const seedNeed = miracle?.needs.seed ?? 0;
  const arkClosed = miracle?.closed.includes("ark") === true;
  const arkNeed = arkClosed ? 0 : (miracle?.needs.ark ?? 0);

  const needRows: { label: string; value: number; col: number; suffix?: string }[] = [
    { label: "Rain (fire/dry)", value: rainNeed, col: WATER_COL },
    { label: "Seed (bare soil)", value: seedNeed, col: GRAZER_COL },
    {
      label: "Ark (new life)",
      value: arkNeed,
      col: OMNI_COL,
      ...(arkClosed ? { suffix: "closed" } : {}),
    },
  ];

  needRows.forEach((nr, idx) => {
    const ny = 183 + idx * 16;
    h.text(nr.label, RIGHT_X0, ny, WORD_INK);
    h.gauge(RIGHT_X0 + 88, ny + 1, 92, 6, nr.value, nr.col);
    h.rightText(nr.suffix ?? `${Math.round(nr.value * 100)}%`, RIGHT_X1, ny, FADED_INK);
  });
}

function lighten(colour: number, amount: number): number {
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  const mix = (c: number): number => Math.min(255, Math.round(c + (255 - c) * amount));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

const GUIDE_TOP = 8;

/** Stateful DOM `<canvas>` overlay controller for the Field Guide. */
export class FieldGuide {
  readonly element = document.createElement("canvas");
  private isOpen = false;
  private progress = 0;
  private idleS = 0;
  private currentTab: GuideTab = "species";
  private selectedSpeciesId: number | null = null;
  private lineageIndex = 0;
  private settingIndex = 0;
  private zones: HitZone[] = [];
  private paintedKey: string | null = null;
  private paintedPortrait: Pixels | null = null;
  private lastLeft = 0;
  private lastTop = 0;
  private miracle: MiracleStatus | null = null;
  private miracleNote: string | null = null;
  private miracleNoteS = 0;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    this.element.dataset.testid = "fieldguide";
  }

  get open(): boolean {
    return this.isOpen;
  }

  get showing(): boolean {
    return this.progress > 0;
  }

  get tab(): GuideTab {
    return this.currentTab;
  }

  get miracleStatus(): MiracleStatus | null {
    return this.miracle;
  }

  setMiracleStatus(status: MiracleStatus | null, note?: string): void {
    this.miracle = status;
    if (note !== undefined) {
      this.miracleNote = note;
      this.miracleNoteS = 5;
    }
  }

  toggle(preferredSpeciesId?: number | null): void {
    this.isOpen = !this.isOpen;
    this.idleS = 0;
    if (this.isOpen && preferredSpeciesId !== undefined && preferredSpeciesId !== null) {
      this.selectedSpeciesId = preferredSpeciesId;
    }
  }

  close(): void {
    this.isOpen = false;
  }

  setTab(tab: GuideTab): void {
    this.currentTab = tab;
    this.idleS = 0;
  }

  /** Representative creature id whose portrait should be drawn on Tab 1, or null. */
  wantedPortraitId(guide: SpeciesGuideSnapshot): number | null {
    if (!this.isOpen && this.progress <= 0) return null;
    if (this.currentTab !== "species" || guide.living.length === 0) return null;
    const found = guide.living.find((s) => s.id === this.selectedSpeciesId) ?? guide.living[0];
    return found?.representativeId ?? null;
  }

  /**
   * Handle a keyboard press while the Field Guide is open. Returns true if consumed.
   */
  handleKey(
    key: string,
    guide: SpeciesGuideSnapshot,
    settings: TerrariumSettings,
    callbacks: {
      onFollowSpecies: (speciesId: number) => void;
      onChangeSettings: (next: TerrariumSettings) => void;
      onInvokeMiracle: () => void;
    },
  ): boolean {
    if (!this.isOpen) return false;
    this.idleS = 0;

    if (key === "Escape" || key === "Tab" || key === "m" || key === "M") {
      this.close();
      return true;
    }
    if (key === "1") {
      this.currentTab = "species";
      return true;
    }
    if (key === "2") {
      this.currentTab = "lineage";
      return true;
    }
    if (key === "3") {
      this.currentTab = "island";
      return true;
    }
    if (key === "[" || key === "]") {
      const order: GuideTab[] = ["species", "lineage", "island"];
      const idx = order.indexOf(this.currentTab);
      const nextIdx = (idx + (key === "]" ? 1 : -1) + order.length) % order.length;
      this.currentTab = order[nextIdx] ?? "species";
      return true;
    }
    if (key === "g" || key === "G") {
      callbacks.onInvokeMiracle();
      return true;
    }

    if (this.currentTab === "species") {
      const { living } = guide;
      if (living.length === 0) return true;
      const curIdx = Math.max(
        0,
        living.findIndex((s) => s.id === this.selectedSpeciesId),
      );
      if (key === "ArrowDown" || key === "j") {
        const next = living[Math.min(living.length - 1, curIdx + 1)];
        if (next !== undefined) this.selectedSpeciesId = next.id;
        return true;
      }
      if (key === "ArrowUp" || key === "k") {
        const prev = living[Math.max(0, curIdx - 1)];
        if (prev !== undefined) this.selectedSpeciesId = prev.id;
        return true;
      }
      if (key === "ArrowRight" || key === "PageDown") {
        const jumped = living[Math.min(living.length - 1, curIdx + SPECIES_PER_PAGE)];
        if (jumped !== undefined) this.selectedSpeciesId = jumped.id;
        return true;
      }
      if (key === "ArrowLeft" || key === "PageUp") {
        const jumped = living[Math.max(0, curIdx - SPECIES_PER_PAGE)];
        if (jumped !== undefined) this.selectedSpeciesId = jumped.id;
        return true;
      }
      if (key === "Enter" || key === " ") {
        const chosen = living[curIdx];
        if (chosen !== undefined) {
          this.close();
          callbacks.onFollowSpecies(chosen.id);
        }
        return true;
      }
      return true;
    }

    if (this.currentTab === "lineage") {
      const { rows } = buildLineageRows(guide.lineage);
      if (rows.length === 0) return true;
      this.lineageIndex = Math.min(Math.max(this.lineageIndex, 0), rows.length - 1);
      if (key === "ArrowDown" || key === "j") {
        this.lineageIndex = Math.min(rows.length - 1, this.lineageIndex + 1);
        return true;
      }
      if (key === "ArrowUp" || key === "k") {
        this.lineageIndex = Math.max(0, this.lineageIndex - 1);
        return true;
      }
      if (key === "ArrowRight" || key === "PageDown") {
        this.lineageIndex = Math.min(rows.length - 1, this.lineageIndex + LINEAGE_PER_COL);
        return true;
      }
      if (key === "ArrowLeft" || key === "PageUp") {
        this.lineageIndex = Math.max(0, this.lineageIndex - LINEAGE_PER_COL);
        return true;
      }
      if (key === "Enter" || key === " ") {
        const node = rows[this.lineageIndex];
        if (node !== undefined && node.members > 0) {
          this.close();
          callbacks.onFollowSpecies(node.id);
        }
        return true;
      }
      return true;
    }

    // `island` settings tab
    if (key === "ArrowDown" || key === "j") {
      this.settingIndex = (this.settingIndex + 1) % 5;
      return true;
    }
    if (key === "ArrowUp" || key === "k") {
      this.settingIndex = (this.settingIndex + 4) % 5;
      return true;
    }
    if (key === "ArrowLeft" || key === "h") {
      callbacks.onChangeSettings(stepSetting(settings, this.settingIndex, -1));
      return true;
    }
    if (key === "ArrowRight" || key === "l" || key === "Enter" || key === " ") {
      callbacks.onChangeSettings(stepSetting(settings, this.settingIndex, 1));
      return true;
    }
    return true;
  }

  /**
   * Handle a pointer click at stage art-pixel coordinates `(artX, artY)` when open.
   * Returns true if the guide was open (consuming clicks outside to close cleanly).
   */
  handlePointer(
    artX: number,
    artY: number,
    settings: TerrariumSettings,
    callbacks: {
      onFollowSpecies: (speciesId: number) => void;
      onChangeSettings: (next: TerrariumSettings) => void;
      onInvokeMiracle: () => void;
    },
  ): boolean {
    if (!this.isOpen) return false;
    this.idleS = 0;
    const lx = artX - this.lastLeft;
    const ly = artY - this.lastTop;
    if (lx < 0 || ly < 0 || lx >= GUIDE_OUTER_W || ly >= GUIDE_OUTER_H) {
      this.close();
      return true;
    }
    for (const zone of this.zones) {
      if (lx >= zone.x0 && lx < zone.x1 && ly >= zone.y0 && ly < zone.y1) {
        const { action } = zone;
        if (action.type === "tab") {
          this.currentTab = action.tab;
        } else if (action.type === "select-species") {
          this.selectedSpeciesId = action.id;
        } else if (action.type === "follow-species") {
          this.close();
          callbacks.onFollowSpecies(action.id);
        } else if (action.type === "select-lineage") {
          this.lineageIndex = action.index;
        } else if (action.type === "setting") {
          this.settingIndex = action.index;
          callbacks.onChangeSettings(stepSetting(settings, action.index, action.delta));
        } else if (action.type === "miracle") {
          callbacks.onInvokeMiracle();
        }
        return true;
      }
    }
    return true;
  }

  update(
    dtS: number,
    inputs: {
      guide: SpeciesGuideSnapshot;
      settings: TerrariumSettings;
      portrait: Pixels | null;
      clock: ClockMessage | null;
      sky: SkyMessage | null;
      lamp?: Rgb;
    },
  ): void {
    if (this.miracleNoteS > 0) {
      this.miracleNoteS = Math.max(0, this.miracleNoteS - dtS);
      if (this.miracleNoteS === 0) this.miracleNote = null;
    }
    if (this.isOpen) {
      this.idleS += dtS;
      if (this.idleS >= GUIDE_IDLE_S) this.isOpen = false;
    }

    if (this.isOpen) {
      this.progress = Math.min(1, this.progress + dtS / GUIDE_IN_S);
    } else {
      this.progress = Math.max(0, this.progress - dtS / GUIDE_OUT_S);
    }

    const open = smooth(this.progress);
    if (open <= 0) {
      this.element.style.display = "none";
      this.paintedKey = null;
      this.paintedPortrait = null;
      return;
    }

    const { guide, settings, portrait, clock, sky, lamp = DAYLIGHT } = inputs;
    if (
      guide.living.length > 0 &&
      (this.selectedSpeciesId === null ||
        !guide.living.some((s) => s.id === this.selectedSpeciesId))
    ) {
      this.selectedSpeciesId = guide.living[0]?.id ?? null;
    }

    const viewState: FieldGuideView = {
      tab: this.currentTab,
      guide,
      selectedSpeciesId: this.selectedSpeciesId,
      lineageIndex: this.lineageIndex,
      settingIndex: this.settingIndex,
      settings,
      portrait,
      clock,
      sky,
      miracle: this.miracle,
      miracleNote: this.miracleNote,
    };

    const key = JSON.stringify([
      viewState.tab,
      viewState.selectedSpeciesId,
      viewState.lineageIndex,
      viewState.settingIndex,
      viewState.settings,
      viewState.clock?.date ?? null,
      viewState.clock?.season ?? null,
      viewState.sky?.rain ?? null,
      viewState.sky?.burning.length ?? 0,
      Math.round((viewState.sky?.light ?? 1) * 100),
      viewState.miracle,
      viewState.miracleNote,
      viewState.guide.totalCreatures,
      viewState.guide.living.map((s) => [
        s.id,
        s.members,
        s.young,
        s.torpid,
        s.grazing,
        s.feeding,
        s.body,
      ]),
      viewState.guide.lineage.length,
      lampKey(lamp),
    ]);

    const share = (v: number, total: number): string => `${(100 * v) / total}%`;
    if (this.paintedKey !== key || this.paintedPortrait !== portrait) {
      this.paintedKey = key;
      this.paintedPortrait = portrait;
      const { picture, zones } = paintFieldGuide(viewState);
      lightPicture(picture, lamp);
      this.zones = zones;
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

    const left = Math.round((this.screenWidth - GUIDE_WIDTH) / 2);
    const hiddenTop = -GUIDE_HEIGHT - 2;
    const top = Math.round(hiddenTop + (GUIDE_TOP - hiddenTop) * open);
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

export type { SpeciesRecord, LivingSpeciesSummary };
