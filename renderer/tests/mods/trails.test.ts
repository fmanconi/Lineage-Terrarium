import { describe, expect, it, beforeEach } from "vitest";
import {
  FootprintsTrailsMod,
  trailSystem,
  isTrailsActive,
  setTrailsActive,
  TRAIL_THRESHOLD,
} from "../../src/mods/builtin/trails";

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
    expect(footprints[0]!.x).toBeCloseTo(20.5, 0);
    expect(footprints[0]!.ageS).toBe(0);
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
