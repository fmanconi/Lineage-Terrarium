/**
 * Eco-Heatmap Overlays Mod (ADR 0024):
 *
 * Real-time ecological diagnostic visualizer for Lineage: Terrarium.
 * Allows switching between specialized diagnostic density maps:
 *   - Flora: plant biomass on land, from the land message (`options.land`).
 *   - Fauna: Animal population distribution, swarm clustering and herd density.
 *   - Activity: Cumulative grazing, browsing and migratory transit hotspots.
 *
 * Hotkey:
 *   - Pressing [E] cycles: FLORA -> FAUNA -> ACTIVITY -> OFF -> FLORA (not [H], which the
 *     field guide's readers reach for).
 *   - Toggling in the Mod Menu [M] enables/disables the diagnostic layer.
 *
 * Drawn as a translucent grid over the island (`layers.over`, in cells) and a badge with
 * the map's name and its colour scale in the bottom-left corner (`layers.screen`).
 *
 * Renderer-only: zero impact on `sim/` determinism or server state.
 */
import { Graphics } from "pixi.js";
import { INK, PAPER } from "../../captions";
import { GLYPH_ROWS, draw as drawCaption, measure } from "../../pixelfont";
import type { Land } from "../../terrain/land";
import type { Mod, ModContext, ModLayers, ModMetadata } from "../types";

export type HeatmapMode = "off" | "flora" | "fauna" | "activity";

export const HEATMAP_MODES: readonly HeatmapMode[] = ["off", "flora", "fauna", "activity"];

export const HEATMAP_TITLES: Record<HeatmapMode, string> = {
  off: "Heatmap: Disabled",
  flora: "Eco-Heatmap: Vegetation Density",
  fauna: "Eco-Heatmap: Creature Population",
  activity: "Eco-Heatmap: Activity Hotspots",
};

export const HEATMAP_GRID_SIZE = 64;

// Palette gradients (4 steps: 0.0 -> 0.33 -> 0.66 -> 1.0)
export const FLORA_GRADIENT = [0x1a3826, 0x2e7d32, 0x4caf50, 0xa5d6a7]; // Deep evergreen -> bright lush emerald
export const FAUNA_GRADIENT = [0x311b92, 0x9c27b0, 0xf44336, 0xffeb3b]; // Deep violet -> magenta -> red-orange -> radiant yellow
export const ACTIVITY_GRADIENT = [0x1a237e, 0x0288d1, 0x00e676, 0xffea00]; // Deep ocean navy -> sky blue -> neon green -> vibrant gold

let heatmapActive = false;

export function isHeatmapActive(): boolean {
  return heatmapActive;
}

export function setHeatmapActive(active: boolean): void {
  heatmapActive = active;
}

export class HeatmapSystem {
  mode: HeatmapMode = "flora";
  readonly faunaGrid = new Float32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);
  readonly floraGrid = new Float32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);
  readonly activityGrid = new Float32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);

  reset(): void {
    this.faunaGrid.fill(0);
    this.floraGrid.fill(0);
    this.activityGrid.fill(0);
    this.mode = "flora";
  }

  cycleMode(): HeatmapMode {
    const currentIndex = HEATMAP_MODES.indexOf(this.mode);
    const nextIndex = (currentIndex + 1) % HEATMAP_MODES.length;
    this.mode = HEATMAP_MODES[nextIndex] ?? "off";
    return this.mode;
  }

  setFloraFromWorld(cells: readonly number[] | Float32Array, worldWidth: number, worldHeight: number): void {
    if (cells.length === 0) return;
    this.floraGrid.fill(0);

    const scaleX = worldWidth / HEATMAP_GRID_SIZE;
    const scaleY = worldHeight / HEATMAP_GRID_SIZE;

    for (let gy = 0; gy < HEATMAP_GRID_SIZE; gy++) {
      for (let gx = 0; gx < HEATMAP_GRID_SIZE; gx++) {
        const wx = Math.floor(gx * scaleX);
        const wy = Math.floor(gy * scaleY);
        const wIdx = wy * worldWidth + wx;
        const val = cells[wIdx] ?? 0;
        this.floraGrid[gy * HEATMAP_GRID_SIZE + gx] = Math.min(1.0, val);
      }
    }
  }

  /** The flora grid as the mean plant biomass (0–1) over the cells under each grid cell. */
  setFloraFromLand(
    land: Pick<Land, "width" | "height" | "heights" | "seaLevel" | "biomass">,
  ): void {
    const { width, height } = land;
    if (width <= 0 || height <= 0) return;
    const sums = new Float32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);
    const counts = new Uint32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);
    for (let y = 0; y < height; y++) {
      const gy = Math.min(HEATMAP_GRID_SIZE - 1, Math.floor((y * HEATMAP_GRID_SIZE) / height));
      for (let x = 0; x < width; x++) {
        const cell = y * width + x;
        const gx = Math.min(HEATMAP_GRID_SIZE - 1, Math.floor((x * HEATMAP_GRID_SIZE) / width));
        const at = gy * HEATMAP_GRID_SIZE + gx;
        // Every cell counts towards its block; the sea adds nothing, so coasts fade.
        counts[at] = (counts[at] ?? 0) + 1;
        if ((land.heights[cell] ?? 0) > land.seaLevel) {
          sums[at] = (sums[at] ?? 0) + (land.biomass[cell] ?? 0) / 255;
        }
      }
    }
    for (let i = 0; i < this.floraGrid.length; i++) {
      const count = counts[i] ?? 0;
      this.floraGrid[i] = count === 0 ? 0 : Math.min(1, (sums[i] ?? 0) / count);
    }
  }

  recordFauna(animals: readonly { x: number; y: number }[], worldWidth = 64, worldHeight = 64): void {
    // Fauna grid is instantaneous density with fast decay
    this.faunaGrid.fill(0);

    const scaleX = HEATMAP_GRID_SIZE / worldWidth;
    const scaleY = HEATMAP_GRID_SIZE / worldHeight;

    for (const a of animals) {
      const gx = Math.floor(a.x * scaleX);
      const gy = Math.floor(a.y * scaleY);
      if (gx >= 0 && gx < HEATMAP_GRID_SIZE && gy >= 0 && gy < HEATMAP_GRID_SIZE) {
        const idx = gy * HEATMAP_GRID_SIZE + gx;
        this.faunaGrid[idx] = Math.min(1.0, (this.faunaGrid[idx] ?? 0) + 0.35);

        // Also accumulate long-term activity
        this.activityGrid[idx] = Math.min(1.0, (this.activityGrid[idx] ?? 0) + 0.05);

        // Spread slightly to neighboring cells for smooth kernel
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && nx < HEATMAP_GRID_SIZE && ny >= 0 && ny < HEATMAP_GRID_SIZE) {
              const nIdx = ny * HEATMAP_GRID_SIZE + nx;
              this.faunaGrid[nIdx] = Math.min(1.0, (this.faunaGrid[nIdx] ?? 0) + 0.12);
            }
          }
        }
      }
    }
  }

  update(dtS: number): void {
    if (dtS <= 0) return;
    // Slow decay on long-term activity hotspots
    const decay = dtS * 0.005;
    for (let i = 0; i < this.activityGrid.length; i++) {
      const current = this.activityGrid[i] ?? 0;
      if (current > 0) {
        this.activityGrid[i] = Math.max(0, current - decay);
      }
    }
  }

  sampleIntensity(gx: number, gy: number): number {
    if (gx < 0 || gx >= HEATMAP_GRID_SIZE || gy < 0 || gy >= HEATMAP_GRID_SIZE) return 0;
    const idx = gy * HEATMAP_GRID_SIZE + gx;

    switch (this.mode) {
      case "flora":
        return this.floraGrid[idx] ?? 0;
      case "fauna":
        return this.faunaGrid[idx] ?? 0;
      case "activity":
        return this.activityGrid[idx] ?? 0;
      case "off":
      default:
        return 0;
    }
  }

  getColorForIntensity(intensity: number): number {
    const clamped = Math.max(0, Math.min(1, intensity));
    const gradient =
      this.mode === "flora"
        ? FLORA_GRADIENT
        : this.mode === "fauna"
          ? FAUNA_GRADIENT
          : this.mode === "activity"
            ? ACTIVITY_GRADIENT
            : FLORA_GRADIENT;

    const segment = clamped * (gradient.length - 1);
    const lowIdx = Math.floor(segment);
    const highIdx = Math.min(gradient.length - 1, lowIdx + 1);
    const t = segment - lowIdx;

    const c1 = gradient[lowIdx] ?? 0;
    const c2 = gradient[highIdx] ?? 0;

    // Linear interpolate RGB channels
    const r1 = (c1 >> 16) & 0xff;
    const g1 = (c1 >> 8) & 0xff;
    const b1 = c1 & 0xff;

    const r2 = (c2 >> 16) & 0xff;
    const g2 = (c2 >> 8) & 0xff;
    const b2 = c2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }
}

export const heatmapSystem = new HeatmapSystem();

/** How often the grid is drawn again while it is shown, seconds. */
export const HEATMAP_REDRAW_S = 0.5;
/** The grid's opacity at full intensity, and the intensity below which a cell stays clear. */
export const HEATMAP_ALPHA = 0.55;
export const HEATMAP_FLOOR = 0.03;
/** The badge's names, short enough for the corner. */
export const HEATMAP_LABELS: Record<HeatmapMode, string> = {
  off: "",
  flora: "Flora",
  fauna: "Fauna",
  activity: "Activity",
};
/** The badge, art pixels: its inset from the corner, padding, and colour scale's swatches. */
const BADGE_INSET = 4;
const BADGE_PAD = 3;
const BADGE_SWATCH = 6;
const BADGE_STEPS = 4;

export class EcoHeatmapMod implements Mod {
  readonly meta: ModMetadata = {
    id: "eco-heatmap",
    name: "Eco-Heatmap Overlays",
    version: "1.0.0",
    description:
      "Diagnostic visualizer displaying real-time thematic overlays: vegetation density, creature population, and grazing activity.",
    defaultEnabled: false,
  };

  /** The grid over the island (cells) and the badge in the corner (screen). */
  private readonly grid = new Graphics();
  private readonly badge = new Graphics();
  readonly layers: ModLayers = { over: this.grid, screen: this.badge };

  private enabled = false;
  private screenHeight = 300;
  /** The land the flora grid was last made from, and the world's size in cells. */
  private floraLand: Land | null = null;
  private worldWidth = HEATMAP_GRID_SIZE;
  private worldHeight = HEATMAP_GRID_SIZE;
  private sinceDrawS = Infinity;
  private badgeMode: HeatmapMode | null = null;

  init(ctx: ModContext): void {
    this.screenHeight = ctx.height;
    this.show(false);
  }

  enable(): void {
    this.enabled = true;
    setHeatmapActive(true);
    if (heatmapSystem.mode === "off") {
      heatmapSystem.mode = "flora";
    }
    this.sinceDrawS = Infinity;
  }

  disable(): void {
    this.enabled = false;
    setHeatmapActive(false);
    this.show(false);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;

    // Press [E]/[e] or [H]/[h] to cycle modes; "off" hides the overlay, the next press brings it back.
    if (e.key === "e" || e.key === "E" || e.key === "h" || e.key === "H") {
      const nextMode = heatmapSystem.cycleMode();
      setHeatmapActive(nextMode !== "off");
      this.sinceDrawS = Infinity;
      return true;
    }

    return false;
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!this.enabled) return;
    const land = options.land;
    if (isLand(land)) {
      this.worldWidth = land.width;
      this.worldHeight = land.height;
      // Each land message makes a new land: the flora grid is remade only then.
      if (land !== this.floraLand) {
        this.floraLand = land;
        heatmapSystem.setFloraFromLand(land);
        this.sinceDrawS = Infinity;
      }
    }
    if (!heatmapActive || heatmapSystem.mode === "off") {
      this.show(false);
      return;
    }

    heatmapSystem.update(dtS);

    if (Array.isArray(options.animals)) {
      heatmapSystem.recordFauna(
        options.animals as { x: number; y: number }[],
        this.worldWidth,
        this.worldHeight,
      );
    }

    this.show(true);
    this.sinceDrawS += dtS;
    if (this.sinceDrawS >= HEATMAP_REDRAW_S) {
      this.sinceDrawS = 0;
      this.drawGrid();
    }
    if (this.badgeMode !== heatmapSystem.mode) this.drawBadge(heatmapSystem.mode);
  }

  private show(visible: boolean): void {
    this.grid.visible = visible;
    this.badge.visible = visible;
  }

  /** The grid in cells: one translucent block per grid cell, coloured on the mode's scale. */
  private drawGrid(): void {
    const g = this.grid;
    g.clear();
    const w = this.worldWidth / HEATMAP_GRID_SIZE;
    const h = this.worldHeight / HEATMAP_GRID_SIZE;
    for (let gy = 0; gy < HEATMAP_GRID_SIZE; gy++) {
      for (let gx = 0; gx < HEATMAP_GRID_SIZE; gx++) {
        const intensity = heatmapSystem.sampleIntensity(gx, gy);
        if (intensity < HEATMAP_FLOOR) continue;
        g.rect(gx * w, gy * h, w, h).fill({
          color: heatmapSystem.getColorForIntensity(intensity),
          alpha: HEATMAP_ALPHA * (0.4 + 0.6 * Math.min(1, intensity)),
        });
      }
    }
  }

  /** The badge: the map's name in the caption font over its colour scale, on paper. */
  private drawBadge(mode: HeatmapMode): void {
    this.badgeMode = mode;
    const g = this.badge;
    g.clear();
    if (mode === "off") return;
    const label = HEATMAP_LABELS[mode];
    const width = Math.max(measure(label), BADGE_STEPS * BADGE_SWATCH) + 2 * BADGE_PAD;
    const height = BADGE_PAD + GLYPH_ROWS + 1 + BADGE_SWATCH + BADGE_PAD;
    const x0 = BADGE_INSET;
    const y0 = this.screenHeight - BADGE_INSET - height;
    g.rect(x0 - 1, y0 - 1, width + 2, height + 2).fill(INK);
    g.rect(x0, y0, width, height).fill(PAPER);
    drawCaption(label, x0 + BADGE_PAD, y0 + BADGE_PAD, (x, y) => {
      g.rect(x, y, 1, 1).fill(INK);
    });
    const scaleY = y0 + BADGE_PAD + GLYPH_ROWS + 1;
    for (let k = 0; k < BADGE_STEPS; k++) {
      g.rect(x0 + BADGE_PAD + k * BADGE_SWATCH, scaleY, BADGE_SWATCH, BADGE_SWATCH).fill(
        heatmapSystem.getColorForIntensity(k / (BADGE_STEPS - 1)),
      );
    }
  }
}

function isLand(value: unknown): value is Land {
  if (typeof value !== "object" || value === null) return false;
  const land = value as Partial<Land>;
  return (
    typeof land.width === "number" &&
    typeof land.height === "number" &&
    typeof land.seaLevel === "number" &&
    land.heights instanceof Float32Array &&
    land.biomass instanceof Uint8Array
  );
}
