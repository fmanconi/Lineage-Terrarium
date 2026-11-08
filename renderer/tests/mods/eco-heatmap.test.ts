import { describe, expect, it, beforeEach } from "vitest";
import {
  EcoHeatmapMod,
  heatmapSystem,
  isHeatmapActive,
  setHeatmapActive,
  HEATMAP_GRID_SIZE,
} from "../../src/mods/builtin/eco-heatmap";

const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;

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

  it("cycles diagnostic modes with [H] hotkey", () => {
    const mod = new EcoHeatmapMod();
    mod.enable();
    expect(heatmapSystem.mode).toBe("flora");

    // Press H -> fauna
    const handled1 = mod.onKey?.(key("h"));
    expect(handled1).toBe(true);
    expect(heatmapSystem.mode).toBe("fauna");

    // Press H -> activity
    const handled2 = mod.onKey?.(key("H"));
    expect(handled2).toBe(true);
    expect(heatmapSystem.mode).toBe("activity");

    // Press H -> off
    const handled3 = mod.onKey?.(key("h"));
    expect(handled3).toBe(true);
    expect(heatmapSystem.mode).toBe("off");
    expect(isHeatmapActive()).toBe(false);
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
