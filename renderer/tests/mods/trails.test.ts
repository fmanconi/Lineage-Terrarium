import { describe, expect, it, beforeEach } from "vitest";
import {
  FootprintsTrailsMod,
  trailSystem,
  isTrailsActive,
  setTrailsActive,
  TRAIL_GRID_SIZE,
} from "../../src/mods/builtin/trails";

/** A land of `width` × `height` cells, all above the sea but for column 0. */
const landOf = (width: number, height: number) => {
  const heights = new Float32Array(width * height).fill(0.6);
  for (let y = 0; y < height; y++) heights[y * width] = 0.1;
  return { width, height, heights, seaLevel: 0.3 };
};

describe("Footprints & Game Trails Mod", () => {
  beforeEach(() => {
    trailSystem.reset();
    setTrailsActive(false);
  });

  it("registers metadata correctly", () => {
    const mod = new FootprintsTrailsMod();
    expect(mod.meta.id).toBe("footprints-trails");
    expect(mod.meta.name).toBe("Footprints & Game Trails");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("enables and disables cleanly", () => {
    const mod = new FootprintsTrailsMod();
    expect(mod.isEnabled()).toBe(false);

    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isTrailsActive()).toBe(true);

    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isTrailsActive()).toBe(false);
  });

  it("spawns footprints when animals move beyond threshold", () => {
    const mod = new FootprintsTrailsMod();
    mod.enable();

    // First frame: animal registers initial position
    trailSystem.observe([{ id: 10, x: 20.0, y: 20.0, heading: 0 }]);
    expect(trailSystem.getFootprints().length).toBe(0);

    // Second frame: animal moves forward by 0.5 cells
    trailSystem.observe([{ id: 10, x: 20.5, y: 20.0, heading: 0 }]);
    const footprints = trailSystem.getFootprints();
    expect(footprints.length).toBe(1);
    expect(footprints[0]?.x).toBeCloseTo(20.5, 0);
    expect(footprints[0]?.ageS).toBe(0);
  });

  it("leaves no print for a jump (another view) or in the sea", () => {
    setTrailsActive(true);
    trailSystem.observe([{ id: 1, x: 20, y: 20 }]);
    // Placed anew far away: no print, the new place remembered
    trailSystem.observe([{ id: 1, x: 60, y: 40 }]);
    expect(trailSystem.getFootprints().length).toBe(0);
    trailSystem.observe([{ id: 1, x: 60.5, y: 40 }]);
    expect(trailSystem.getFootprints().length).toBe(1);

    const land = landOf(64, 64);
    const onLand = (x: number, y: number): boolean =>
      (land.heights[Math.floor(y) * land.width + Math.floor(x)] ?? 0) > land.seaLevel;
    trailSystem.observe([{ id: 2, x: 0.1, y: 5 }], onLand);
    trailSystem.observe([{ id: 2, x: 0.7, y: 5 }], onLand);
    expect(trailSystem.getFootprints().length).toBe(1);
    expect(trailSystem.getWear(0, 5)).toBe(0);
  });

  it("fits the wear grid to the world's size", () => {
    expect(trailSystem.width).toBe(TRAIL_GRID_SIZE);
    trailSystem.resize(256, 150);
    trailSystem.addWear(200, 140, 5);
    expect(trailSystem.getWear(200, 140)).toBe(5);
    expect(trailSystem.getWear(256, 0)).toBe(0);
    trailSystem.resize(TRAIL_GRID_SIZE, TRAIL_GRID_SIZE);
    expect(trailSystem.getWear(20, 20)).toBe(0);
  });

  it("draws paths and prints on its ground layer from the frame's animals and land", () => {
    const mod = new FootprintsTrailsMod();
    const ground = mod.layers.ground;
    expect(ground).toBeDefined();
    mod.enable();
    const land = landOf(TRAIL_GRID_SIZE, TRAIL_GRID_SIZE);
    for (let k = 0; k < 12; k++) {
      mod.update(1 / 30, {
        land,
        tile: 32,
        view: "local",
        animals: [{ id: 7, x: 10 + (k % 2) * 0.5, y: 10 }],
      });
    }
    expect(trailSystem.getFootprints().length).toBeGreaterThan(0);
    expect(trailSystem.getWear(10, 10)).toBeGreaterThan(0);
    expect(ground?.visible).toBe(true);
    expect(ground?.getLocalBounds().width).toBeGreaterThan(0);

    mod.disable();
    expect(ground?.visible).toBe(false);
    expect(trailSystem.getFootprints().length).toBe(0);
  });

  it("accumulates wear on repeated traffic to form beaten paths", () => {
    const mod = new FootprintsTrailsMod();
    mod.enable();

    // Simulate an animal pacing over the same path 10 times
    for (let step = 0; step < 10; step++) {
      trailSystem.addWear(15, 15, 1.0);
    }

    expect(trailSystem.getWear(15, 15)).toBe(10.0);
    expect(trailSystem.isBeatenPath(15, 15)).toBe(true);
    expect(trailSystem.isBeatenPath(16, 15)).toBe(false);
  });

  it("decays footprints over time and washes trails with rain", () => {
    const mod = new FootprintsTrailsMod();
    mod.enable();

    trailSystem.addFootprint(10, 10, 0, 1);
    expect(trailSystem.getFootprints().length).toBe(1);

    // After 5 seconds, the footprint exceeds TTL and is purged
    trailSystem.update(5.0, 0);
    expect(trailSystem.getFootprints().length).toBe(0);

    // Test rain wash on trail wear
    trailSystem.addWear(25, 25, 10.0);
    expect(trailSystem.getWear(25, 25)).toBe(10.0);

    // Heavy rain (rain = 1.0) over 20 seconds
    trailSystem.update(20.0, 1.0);
    expect(trailSystem.getWear(25, 25)).toBeLessThan(10.0);
  });
});
