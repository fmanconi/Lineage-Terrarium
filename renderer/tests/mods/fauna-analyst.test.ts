import { describe, expect, it } from "vitest";
import { FaunaAnalystMod } from "../../src/mods/builtin/fauna-analyst";

describe("FaunaAnalystMod", () => {
  it("registers metadata with defaultEnabled=true", () => {
    const mod = new FaunaAnalystMod();
    expect(mod.meta.id).toBe("fauna-analyst");
    expect(mod.meta.name).toBe("Fauna Analyst");
    expect(mod.meta.defaultEnabled).toBe(true);
    expect(mod.layers.over).toBeDefined();
  });

  it("cycles through all 4 diagnostic modes with [E]", () => {
    const mod = new FaunaAnalystMod();
    mod.enable();
    expect(mod.getMode()).toBe("vectors");

    expect(mod.onKey({ key: "e" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("density");

    expect(mod.onKey({ key: "E" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("killzones");

    expect(mod.onKey({ key: "e" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("territories");

    expect(mod.onKey({ key: "e" } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getMode()).toBe("vectors");
  });

  it("records and renders kill events", () => {
    const mod = new FaunaAnalystMod();
    mod.enable();
    mod.setMode("killzones");

    mod.recordKill(50, 50, 10);
    expect(mod.getKillEvents().length).toBe(1);
    expect(mod.getKillEvents()[0]?.x).toBe(50);

    mod.update(0.1, { view: "local", animals: [] });
    expect(mod.layers.over?.visible).toBe(true);

    // After expiration, kill event drops
    mod.update(15, { view: "local", animals: [] });
    expect(mod.getKillEvents().length).toBe(0);
  });

  it("draws density and territories overlays", () => {
    const mod = new FaunaAnalystMod();
    mod.enable();
    const animals = [
      { id: 1, x: 10, y: 10, species: 1 },
      { id: 2, x: 11, y: 10, species: 1 },
      { id: 3, x: 10, y: 11, species: 1 },
    ];

    mod.setMode("density");
    mod.update(0.1, { view: "middle", animals });
    expect(mod.layers.over?.visible).toBe(true);

    mod.setMode("territories");
    mod.update(0.1, { view: "middle", animals });
    expect(mod.layers.over?.visible).toBe(true);
  });
});
