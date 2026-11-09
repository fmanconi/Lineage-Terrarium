import { describe, expect, it } from "vitest";
import {
  BAR_COLOURS,
  CRITICAL_AT,
  HealthBarsMod,
  LINGER_S,
  SHOW_BELOW,
  barOf,
} from "../../src/mods/builtin/healthbars";

describe("Health Bars mod", () => {
  it("registers its metadata", () => {
    const mod = new HealthBarsMod();
    expect(mod.meta.id).toBe("health-bars");
    expect(mod.meta.defaultEnabled).toBe(true);
    expect(mod.layers.over).toBeDefined();
  });

  it("shows a bar only below a third of a full reserve", () => {
    expect(SHOW_BELOW / 16).toBeLessThan(1 / 3 + 0.01);
    expect(barOf(undefined)).toBeNull();
    expect(barOf(15)).toBeNull();
    expect(barOf(SHOW_BELOW)).toBeNull();
    expect(barOf(SHOW_BELOW - 1)).not.toBeNull();
  });

  it("is amber while low and red when nearly starved, and never empty", () => {
    expect(barOf(SHOW_BELOW - 1)?.colour).toBe(BAR_COLOURS.low);
    expect(barOf(CRITICAL_AT)?.colour).toBe(BAR_COLOURS.critical);
    expect(barOf(0)?.colour).toBe(BAR_COLOURS.critical);
    expect(barOf(0)?.fill).toBeGreaterThan(0);
    expect(barOf(SHOW_BELOW - 1)?.fill).toBe(SHOW_BELOW / 16);
  });

  it("shows on a fighter whatever its energy, green when well", () => {
    expect(barOf(15, true)).toEqual({ fill: 1, colour: BAR_COLOURS.well });
    expect(barOf(8, true)?.colour).toBe(BAR_COLOURS.well);
    expect(barOf(1, true)?.colour).toBe(BAR_COLOURS.critical);
    expect(barOf(undefined, true)).toBeNull();
  });

  it("keeps a fighter's bar up a while after the fight", () => {
    const mod = new HealthBarsMod();
    mod.enable();
    const draws = (): number =>
      (mod.layers.over?.children[0] as { context?: { instructions?: unknown[] } }).context
        ?.instructions?.length ?? 0;
    mod.update(0.016, {
      view: "local",
      animals: [{ id: 7, x: 5, y: 5, energy: 14, fighting: true }],
    });
    expect(draws()).toBeGreaterThan(0);
    mod.update(1, { view: "local", animals: [{ id: 7, x: 5, y: 5, energy: 14 }] });
    expect(draws()).toBeGreaterThan(0);
    mod.update(LINGER_S, { view: "local", animals: [{ id: 7, x: 5, y: 5, energy: 14 }] });
    expect(draws()).toBe(0);
  });

  it("draws only in the middle and local views, and only while on", () => {
    const mod = new HealthBarsMod();
    const animals = [
      { x: 10, y: 10, energy: 1 },
      { x: 12, y: 10, energy: 12 },
    ];
    const over = mod.layers.over;
    mod.update(0.016, { view: "local", animals });
    expect(over?.visible).toBe(false); // off
    mod.enable();
    mod.update(0.016, { view: "local", animals });
    expect(over?.visible).toBe(true);
    mod.update(0.016, { view: "map", animals });
    expect(over?.visible).toBe(false);
    mod.update(0.016, { view: "middle", animals });
    expect(over?.visible).toBe(true);
    mod.disable();
    expect(over?.visible).toBe(false);
  });

  it("cycles display modes between smart, always, and focused with [H]", () => {
    const mod = new HealthBarsMod();
    mod.enable();
    expect(mod.getMode()).toBe("smart");
    expect(mod.onKey?.({ key: "h" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("always");
    expect(mod.onKey?.({ key: "H" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("focused");
    expect(mod.onKey?.({ key: "h" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("smart");

    // In focused mode, draws only for the followed animal
    mod.setMode("focused");
    const animals = [
      { id: 1, x: 5, y: 5, energy: 2 },
      { id: 2, x: 8, y: 8, energy: 2 },
    ];
    mod.update(0.016, { view: "local", animals, focusedId: 1 });
    expect(mod.layers.over?.visible).toBe(true);
  });
});
