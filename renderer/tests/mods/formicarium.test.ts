import { beforeEach, describe, expect, it } from "vitest";
import {
  FormicariumMod,
  FormicariumSystem,
  PheromoneGrid,
  formicariumSystem,
  isFormicariumActive,
  isPheromoneOverlayActive,
  setFormicariumActive,
  setPheromoneOverlayActive,
  togglePheromoneOverlay,
} from "../../src/mods/builtin/formicarium";
import { memoryStorage } from "../../src/mods/registry";

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;

describe("Ant Colonies", () => {
  beforeEach(() => {
    setFormicariumActive(false);
    setPheromoneOverlayActive(false);
    formicariumSystem.grid.reset();
  });

  it("registers correct metadata", () => {
    const mod = new FormicariumMod();
    expect(mod.meta.id).toBe("formicarium");
    expect(mod.meta.name).toBe("Ant Colonies");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("enables and disables global active flag and controls layers", () => {
    const mod = new FormicariumMod();
    mod.init({ frame: {} as HTMLElement, width: 512, height: 300, storage: memoryStorage() });

    expect(mod.isEnabled()).toBe(false);
    expect(isFormicariumActive()).toBe(false);

    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isFormicariumActive()).toBe(true);
    expect(mod.layers?.ground?.visible).toBe(true);
    expect(mod.layers?.over?.visible).toBe(true);
    expect(mod.layers?.screen?.visible).toBe(true);

    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isFormicariumActive()).toBe(false);
    expect(mod.layers?.ground?.visible).toBe(false);
    expect(mod.layers?.over?.visible).toBe(false);
    expect(mod.layers?.screen?.visible).toBe(false);
  });

  it("toggles pheromone overlay with key [I] and helper functions", () => {
    const mod = new FormicariumMod();
    mod.enable();

    expect(isPheromoneOverlayActive()).toBe(false);
    expect(mod.onKey(key("i"))).toBe(true);
    expect(isPheromoneOverlayActive()).toBe(true);

    expect(mod.onKey(key("I"))).toBe(true);
    expect(isPheromoneOverlayActive()).toBe(false);

    expect(togglePheromoneOverlay()).toBe(true);
    expect(isPheromoneOverlayActive()).toBe(true);

    expect(mod.onKey(key("x"))).toBe(false);
  });

  it("deposits, samples and decays pheromone trails in PheromoneGrid", () => {
    const grid = new PheromoneGrid();
    const w = 64;
    const h = 64;

    expect(grid.sampleFood(30, 30, w, h)).toBe(0);
    expect(grid.sampleAlarm(30, 30, w, h)).toBe(0);

    grid.depositFood(30, 30, w, h, 0.5);
    grid.depositAlarm(30, 30, w, h, 0.8);

    expect(grid.sampleFood(30, 30, w, h)).toBeCloseTo(0.5, 2);
    expect(grid.sampleAlarm(30, 30, w, h)).toBeCloseTo(0.8, 2);

    // Decay test
    grid.update(2.0); // 2 seconds of evaporation
    expect(grid.sampleFood(30, 30, w, h)).toBeLessThan(0.5);
    expect(grid.sampleAlarm(30, 30, w, h)).toBeLessThan(0.8);
    expect(grid.sampleFood(30, 30, w, h)).toBeGreaterThan(0.2);

    grid.reset();
    expect(grid.sampleFood(30, 30, w, h)).toBe(0);
  });

  it("senses directional food trail gradient ahead", () => {
    const grid = new PheromoneGrid();
    const w = 64;
    const h = 64;

    // Lay strong trail directly north (heading = -Math.PI / 2)
    grid.depositFood(32, 28, w, h, 0.9);

    const sensed = grid.senseFoodHeading(32, 30, -Math.PI / 2, w, h);
    if (sensed === null) throw new Error("no food heading sensed");
    // Angle should point approximately north
    expect(sensed).toBeCloseTo(-Math.PI / 2, 1);
  });

  it("initializes 3 distinct colonies with populations", () => {
    const system = new FormicariumSystem();
    expect(system.colonies.length).toBe(3);

    const [red, black, amber] = system.colonies;
    expect(red?.species).toBe("Formica rufa");
    expect(black?.species).toBe("Lasius niger");
    expect(amber?.species).toBe("Camponotus ligniperda");

    expect(red?.ants.length).toBeGreaterThan(20);
    expect(black?.ants.length).toBeGreaterThan(20);
    expect(amber?.ants.length).toBeGreaterThan(20);
  });

  it("adapts colonies safely to dry land heights", () => {
    const system = new FormicariumSystem();
    const heights = new Float32Array(64 * 64).fill(0.1); // water by default (seaLevel = 0.5)

    // Dry spot at (25, 25)
    for (let dy = 0; dy < 10; dy++) {
      for (let dx = 0; dx < 10; dx++) {
        heights[(25 + dy) * 64 + (25 + dx)] = 0.8;
      }
    }

    system.adaptToLand({
      width: 64,
      height: 64,
      seaLevel: 0.5,
      heights,
    });

    for (const col of system.colonies) {
      expect(col.moundX).toBeGreaterThanOrEqual(0);
      expect(col.moundY).toBeGreaterThanOrEqual(0);
    }
  });

  it("triggers alarm when large creature steps near a mound", () => {
    const system = new FormicariumSystem();
    const red = defined(system.colonies[0]);
    expect(red.alarmLevel).toBe(0);

    // Intruding creature at mound location
    system.update(0.5, [{ id: 99, x: red.moundX, y: red.moundY }]);
    expect(red.alarmLevel).toBeGreaterThan(0.2);
  });

  it("advances ant simulation, returns payload and stores food in nest", () => {
    const system = new FormicariumSystem();
    const red = defined(system.colonies[0]);
    const ant = defined(red.ants[0]);

    // Set ant to returning with food payload near mound
    ant.state = "returning";
    ant.carrying = "leaf";
    ant.x = red.moundX + 0.3;
    ant.y = red.moundY + 0.3;

    const initialStores = red.foodStores;
    system.update(0.1, []);

    expect(red.foodStores).toBe(initialStores + 1);
    expect(ant.carrying).toBe("none");
    expect(ant.state).toBe("resting");
  });

  it("renders updates through Mod interface without errors", () => {
    const mod = new FormicariumMod();
    mod.init({ frame: {} as HTMLElement, width: 512, height: 300, storage: memoryStorage() });
    mod.enable();

    expect(() => {
      mod.update(0.016, {
        tile: 4,
        land: {
          width: 64,
          height: 64,
          seaLevel: 0.5,
          heights: new Float32Array(64 * 64).fill(0.6),
        },
        animals: [{ id: 1, x: 20, y: 22 }],
      });
    }).not.toThrow();

    // Now test with Macro Zoom (tile = 16) and pheromone overlay enabled
    togglePheromoneOverlay();
    expect(() => {
      mod.update(0.016, {
        tile: 16,
        animals: [{ id: 1, x: 20, y: 22 }],
      });
    }).not.toThrow();
  });
});
