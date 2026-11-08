/**
 * Eco-Heatmap Overlays Mod (ADR 0024):
 *
 * Real-time ecological diagnostic visualizer for Lineage: Terrarium.
 * Allows switching between specialized diagnostic density maps:
 *   - [H] Flora: Vegetation biomass, canopy density and plant vitality.
 *   - [H] Fauna: Animal population distribution, swarm clustering and herd density.
 *   - [H] Activity: Cumulative grazing, browsing and migratory transit hotspots.
 *
 * Hotkey:
 *   - Pressing [H] cycles: OFF -> FLORA -> FAUNA -> ACTIVITY -> OFF.
 *   - Toggling in the Mod Menu [M] enables/disables the diagnostic layer.
 *
 * Renderer-only: zero impact on `sim/` determinism or server state.
 */
import type { Mod, ModContext, ModMetadata } from "../types";

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

export class EcoHeatmapMod implements Mod {
  readonly meta: ModMetadata = {
    id: "eco-heatmap",
    name: "Eco-Heatmap Overlays",
    version: "1.0.0",
    description:
      "Diagnostic visualizer displaying real-time thematic overlays: vegetation density, creature population, and grazing activity.",
    defaultEnabled: true,
  };

  init(_ctx: ModContext): void {
    // Initialised
  }

  enable(): void {
    setHeatmapActive(true);
    if (heatmapSystem.mode === "off") {
      heatmapSystem.mode = "flora";
    }
  }

  disable(): void {
    setHeatmapActive(false);
  }

  isEnabled(): boolean {
    return isHeatmapActive();
  }

  onKey(e: KeyboardEvent): boolean {
    if (!heatmapActive) return false;

    // Press [H] or [h] to cycle modes
    if (e.key === "h" || e.key === "H") {
      const nextMode = heatmapSystem.cycleMode();
      if (nextMode === "off") {
        setHeatmapActive(false);
      } else {
        setHeatmapActive(true);
      }
      return true;
    }

    return false;
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!heatmapActive || heatmapSystem.mode === "off") return;

    heatmapSystem.update(dtS);

    if (Array.isArray(options.animals)) {
      heatmapSystem.recordFauna(options.animals as { x: number; y: number }[]);
    }
  }
}
