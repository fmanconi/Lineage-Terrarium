import { afterEach, describe, expect, it } from "vitest";

import {
  ChristmasMod,
  isChristmasActive,
  setChristmasActive,
} from "../../src/mods/builtin/christmas";
import { MODS_STORAGE_KEY, ModRegistry, memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";

const CTX = {
  frame: {} as HTMLElement,
  width: 512,
  height: 300,
  storage: memoryStorage(),
} satisfies ModContext;

afterEach(() => {
  setChristmasActive(false);
});

describe("ChristmasMod", () => {
  it("declares itself on by default", () => {
    const mod = new ChristmasMod();
    expect(mod.meta.id).toBe("christmas-yule");
    expect(mod.meta.name).toBe("Winter Yule & Christmas Isle");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.description).toContain("Santa hats");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("switches the festive flag on and off", () => {
    const mod = new ChristmasMod();
    expect(isChristmasActive()).toBe(false);
    mod.enable();
    expect(isChristmasActive()).toBe(true);
    expect(mod.isEnabled()).toBe(true);
    mod.disable();
    expect(isChristmasActive()).toBe(false);
    expect(mod.isEnabled()).toBe(false);
  });

  it("is on when the registry starts it, and its toggle is kept", () => {
    const storage = memoryStorage();
    const registry = new ModRegistry(storage);
    registry.register(new ChristmasMod());
    registry.initAll(CTX);
    expect(isChristmasActive()).toBe(true);
    expect(registry.isModEnabled("christmas-yule")).toBe(true);
    expect(registry.toggleMod("christmas-yule")).toBe(false);
    expect(isChristmasActive()).toBe(false);
    expect(JSON.parse(storage.getItem(MODS_STORAGE_KEY) ?? "{}")).toEqual({
      "christmas-yule": false,
    });

    // A reload with the stored state: it starts off.
    setChristmasActive(true);
    const again = new ModRegistry(storage);
    again.register(new ChristmasMod());
    again.initAll(CTX);
    expect(isChristmasActive()).toBe(false);
    expect(again.toggleMod("christmas-yule")).toBe(true);
    expect(isChristmasActive()).toBe(true);
  });
});
