import { describe, expect, it, beforeEach } from "vitest";
import {
  EcoHeatmapMod,
  heatmapSystem,
  isHeatmapActive,
  setHeatmapActive,
  HEATMAP_GRID_SIZE,
} from "../../src/mods/builtin/eco-heatmap";
import { memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";

const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;
const ctx: ModContext = {
  frame: {} as HTMLElement,
  width: 512,
  height: 300,
  storage: memoryStorage(),
};

describe("Eco-Heatmap Overlays Mod", () => {
  beforeEach(() => {
    heatmapSystem.reset();
    setHeatmapActive(false);
  });

  it("registers metadata correctly", () => {
    const mod = new EcoHeatmapMod();
    expect(mod.meta.id).toBe("eco-heatmap");
    expect(mod.meta.name).toBe("Eco-Heatmap Overlays");
    expect(mod.meta.defaultEnabled).toBe(false);
  });

  it("enables, disables and handles state cleanly", () => {
    const mod = new EcoHeatmapMod();
    expect(mod.isEnabled()).toBe(false);

    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isHeatmapActive()).toBe(true);
    expect(heatmapSystem.mode).toBe("flora");

    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isHeatmapActive()).toBe(false);
  });

  it("cycles diagnostic modes with [E] hotkey, and leaves [H] alone", () => {
    const mod = new EcoHeatmapMod();
    mod.enable();
    expect(heatmapSystem.mode).toBe("flora");

    expect(mod.onKey?.(key("h"))).toBe(false);
    expect(heatmapSystem.mode).toBe("flora");

    // Press E -> fauna
    const handled1 = mod.onKey?.(key("e"));
    expect(handled1).toBe(true);
    expect(heatmapSystem.mode).toBe("fauna");

    // Press E -> activity
    const handled2 = mod.onKey?.(key("E"));
    expect(handled2).toBe(true);
    expect(heatmapSystem.mode).toBe("activity");

    // Press E -> off
    const handled3 = mod.onKey?.(key("e"));
    expect(handled3).toBe(true);
    expect(heatmapSystem.mode).toBe("off");
    expect(isHeatmapActive()).toBe(false);

    // Still on in the menu: the next press brings the flora back
    expect(mod.isEnabled()).toBe(true);
    expect(mod.onKey?.(key("e"))).toBe(true);
    expect(heatmapSystem.mode).toBe("flora");
    expect(isHeatmapActive()).toBe(true);
  });

  it("feeds the flora grid from options.land and draws the grid and badge", () => {
    const mod = new EcoHeatmapMod();
    mod.init(ctx);
    expect(mod.layers.over?.visible).toBe(false);
    mod.enable();

    // A 128 × 64 world: sea on the left half, full biomass on the right half
    const width = 128;
    const height = 64;
    const heights = new Float32Array(width * height);
    const biomass = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = width / 2; x < width; x++) {
        heights[y * width + x] = 0.8;
        biomass[y * width + x] = 255;
      }
    }
    const land = { width, height, heights, seaLevel: 0.3, biomass };
    mod.update(0.1, { land, animals: [] });

    expect(heatmapSystem.sampleIntensity(5, 5)).toBe(0);
    expect(heatmapSystem.sampleIntensity(HEATMAP_GRID_SIZE - 2, 5)).toBeCloseTo(1, 5);
    expect(mod.layers.over?.visible).toBe(true);
    expect(mod.layers.screen?.visible).toBe(true);
    // The grid covers the land half of the world, in cells
    const bounds = mod.layers.over?.getLocalBounds();
    expect(bounds?.x).toBeCloseTo(width / 2, 5);
    expect(bounds?.width).toBeCloseTo(width / 2, 5);
    // The badge sits in the bottom-left corner of the screen
    const badge = mod.layers.screen?.getLocalBounds();
    expect(badge?.x).toBeLessThan(10);
    expect((badge?.y ?? 0) + (badge?.height ?? 0)).toBeLessThanOrEqual(300);

    mod.disable();
    expect(mod.layers.over?.visible).toBe(false);
    expect(mod.layers.screen?.visible).toBe(false);
  });

  it("makes the flora grid again only for a new land", () => {
    const mod = new EcoHeatmapMod();
    mod.init(ctx);
    mod.enable();
    const size = HEATMAP_GRID_SIZE;
    const land = {
      width: size,
      height: size,
      heights: new Float32Array(size * size).fill(0.8),
      seaLevel: 0.3,
      biomass: new Uint8Array(size * size).fill(128),
    };
    mod.update(0.1, { land });
    expect(heatmapSystem.sampleIntensity(3, 3)).toBeCloseTo(128 / 255, 5);
    heatmapSystem.floraGrid.fill(0);
    mod.update(0.1, { land });
    expect(heatmapSystem.sampleIntensity(3, 3)).toBe(0);
    mod.update(0.1, { land: { ...land } });
    expect(heatmapSystem.sampleIntensity(3, 3)).toBeCloseTo(128 / 255, 5);
  });

  it("records fauna positions and creates density hotspots", () => {
    const mod = new EcoHeatmapMod();
    mod.enable();
    heatmapSystem.mode = "fauna";

    // Place 3 animals near cell (10, 10)
    heatmapSystem.recordFauna(
      [
        { x: 10, y: 10 },
        { x: 10.2, y: 10.1 },
        { x: 10.1, y: 10.3 },
      ],
      64,
      64,
    );

    const intensity = heatmapSystem.sampleIntensity(10, 10);
    expect(intensity).toBeGreaterThan(0.5);

    // Empty area has 0 intensity
    expect(heatmapSystem.sampleIntensity(50, 50)).toBe(0);

    // Color gradient maps intensity to RGB integer
    const color = heatmapSystem.getColorForIntensity(intensity);
    expect(typeof color).toBe("number");
    expect(color).toBeGreaterThan(0);
  });

  it("samples flora grid properly", () => {
    const cells = new Float32Array(HEATMAP_GRID_SIZE * HEATMAP_GRID_SIZE);
    cells[5 * HEATMAP_GRID_SIZE + 5] = 0.85;

    heatmapSystem.setFloraFromWorld(cells, HEATMAP_GRID_SIZE, HEATMAP_GRID_SIZE);
    heatmapSystem.mode = "flora";

    expect(heatmapSystem.sampleIntensity(5, 5)).toBeCloseTo(0.85, 2);
    expect(heatmapSystem.sampleIntensity(20, 20)).toBe(0);
  });
});
