import { describe, expect, it } from "vitest";

import { DashboardButtonsMod, type KeyBarLike } from "../../src/mods/builtin/dashboard-buttons";
import { MENU_HEIGHT, MENU_WIDTH, paintModMenu, scrollOffset } from "../../src/mods/menu";
import { MODS_STORAGE_KEY, ModRegistry, memoryStorage } from "../../src/mods/registry";
import type { Mod, ModContext, ModMetadata } from "../../src/mods/types";
import type { StorageLike } from "../../src/settings";

/** A mod that writes down every call it gets. */
class SpyMod implements Mod {
  readonly meta: ModMetadata;
  readonly calls: string[] = [];
  private on = false;

  constructor(
    id: string,
    defaultEnabled: boolean,
    private readonly consumes = false,
  ) {
    this.meta = { id, name: id, version: "1.0.0", description: `The ${id} mod.`, defaultEnabled };
  }

  init(): void {
    this.calls.push("init");
  }
  enable(): void {
    this.on = true;
    this.calls.push("enable");
  }
  disable(): void {
    this.on = false;
    this.calls.push("disable");
  }
  isEnabled(): boolean {
    return this.on;
  }
  update(dtS: number): void {
    this.calls.push(`update ${dtS}`);
  }
  onKey(e: KeyboardEvent): boolean {
    this.calls.push(`key ${e.key}`);
    return this.consumes;
  }
  onPointer(artX: number, artY: number): boolean {
    this.calls.push(`pointer ${artX},${artY}`);
    return this.consumes;
  }
}

const CTX = {
  frame: {} as HTMLElement,
  width: 512,
  height: 300,
  storage: memoryStorage(),
} satisfies ModContext;

const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;
const click = {} as PointerEvent;

describe("ModRegistry", () => {
  it("registers mods in order and refuses a duplicate id", () => {
    const registry = new ModRegistry(memoryStorage());
    const a = new SpyMod("a", true);
    const b = new SpyMod("b", false);
    registry.register(a);
    registry.register(b);
    expect(registry.getMods().map((m) => m.meta.id)).toEqual(["a", "b"]);
    expect(registry.getMod("b")).toBe(b);
    expect(registry.getMod("missing")).toBeUndefined();
    expect(() => registry.register(new SpyMod("a", false))).toThrow(/already registered/);
  });

  it("takes each mod's default until it is toggled", () => {
    const registry = new ModRegistry(memoryStorage());
    registry.register(new SpyMod("on", true));
    registry.register(new SpyMod("off", false));
    expect(registry.isModEnabled("on")).toBe(true);
    expect(registry.isModEnabled("off")).toBe(false);
    expect(registry.isModEnabled("missing")).toBe(false);
  });

  it("initialises every mod once, then enables or disables it by its state", () => {
    const registry = new ModRegistry(memoryStorage());
    const a = new SpyMod("a", true);
    const b = new SpyMod("b", false);
    registry.register(a);
    registry.register(b);
    expect(a.calls).toEqual([]);
    registry.initAll(CTX);
    expect(a.calls).toEqual(["init", "enable"]);
    expect(b.calls).toEqual(["init", "disable"]);
    // A mod registered after `initAll` starts at once.
    const c = new SpyMod("c", true);
    registry.register(c);
    expect(c.calls).toEqual(["init", "enable"]);
  });

  it("toggles a mod, calling enable and disable only on a change", () => {
    const registry = new ModRegistry(memoryStorage());
    const a = new SpyMod("a", true);
    registry.register(a);
    registry.initAll(CTX);
    a.calls.length = 0;
    expect(registry.toggleMod("a")).toBe(false);
    expect(a.isEnabled()).toBe(false);
    expect(registry.toggleMod("a")).toBe(true);
    expect(a.isEnabled()).toBe(true);
    registry.setModEnabled("a", true);
    expect(a.calls).toEqual(["disable", "enable"]);
    expect(registry.toggleMod("missing")).toBe(false);
  });

  it("does not switch a mod before initAll, but remembers the state", () => {
    const registry = new ModRegistry(memoryStorage());
    const a = new SpyMod("a", true);
    registry.register(a);
    registry.setModEnabled("a", false);
    expect(a.calls).toEqual([]);
    registry.initAll(CTX);
    expect(a.calls).toEqual(["init", "disable"]);
  });

  it("saves the state and loads it back in a new registry", () => {
    const storage = memoryStorage();
    const first = new ModRegistry(storage);
    first.register(new SpyMod("a", true));
    first.register(new SpyMod("b", false));
    first.toggleMod("a");
    first.toggleMod("b");
    expect(JSON.parse(storage.getItem(MODS_STORAGE_KEY) ?? "null")).toEqual({ a: false, b: true });

    const second = new ModRegistry(storage);
    const a = new SpyMod("a", true);
    const b = new SpyMod("b", false);
    second.register(a);
    second.register(b);
    second.initAll(CTX);
    expect(second.isModEnabled("a")).toBe(false);
    expect(second.isModEnabled("b")).toBe(true);
    expect(a.calls).toEqual(["init", "disable"]);
    expect(b.calls).toEqual(["init", "enable"]);
  });

  it("falls back to defaults on a corrupt or foreign stored state", () => {
    for (const raw of ["not json", "[true]", "null", '{"a": "yes"}']) {
      const storage = memoryStorage();
      storage.setItem(MODS_STORAGE_KEY, raw);
      const registry = new ModRegistry(storage);
      registry.register(new SpyMod("a", true));
      expect(registry.isModEnabled("a")).toBe(true);
    }
  });

  it("works without storage, and ignores a storage that refuses to write", () => {
    const none = new ModRegistry(null);
    none.register(new SpyMod("a", true));
    expect(none.toggleMod("a")).toBe(false);

    const refusing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const registry = new ModRegistry(refusing);
    registry.register(new SpyMod("a", true));
    expect(registry.toggleMod("a")).toBe(false);
    expect(registry.isModEnabled("a")).toBe(false);
  });

  it("dispatches updates, keys and clicks to enabled mods only, in order", () => {
    const registry = new ModRegistry(memoryStorage());
    const a = new SpyMod("a", true);
    const off = new SpyMod("off", false);
    const b = new SpyMod("b", true, true);
    const c = new SpyMod("c", true);
    for (const mod of [a, off, b, c]) registry.register(mod);
    // Nothing is dispatched before the mods are started.
    registry.dispatchUpdate(0.5, {});
    expect(registry.dispatchKey(key("x"))).toBe(false);
    registry.initAll(CTX);
    for (const mod of [a, off, b, c]) mod.calls.length = 0;

    registry.dispatchUpdate(0.25, {});
    expect(registry.dispatchKey(key("x"))).toBe(true);
    expect(registry.dispatchPointer(3, 4, click)).toBe(true);
    expect(a.calls).toEqual(["update 0.25", "key x", "pointer 3,4"]);
    expect(b.calls).toEqual(["update 0.25", "key x", "pointer 3,4"]);
    // `b` used the key and the click, so `c` sees neither.
    expect(c.calls).toEqual(["update 0.25"]);
    expect(off.calls).toEqual([]);
  });
});

describe("DashboardButtonsMod", () => {
  const stubBar = (): KeyBarLike & { log: string[] } => {
    const log: string[] = [];
    return {
      log,
      element: { style: { display: "none" } } as HTMLCanvasElement,
      wake: () => log.push("wake"),
      hitAt: () => "guide",
      update: (dtS: number) => {
        log.push(`update ${dtS}`);
      },
    };
  };

  it("is on by default and shows the bar", () => {
    const bar = stubBar();
    const mod = new DashboardButtonsMod(bar);
    const registry = new ModRegistry(memoryStorage());
    registry.register(mod);
    registry.initAll(CTX);
    expect(mod.meta.id).toBe("dashboard-buttons");
    expect(mod.isEnabled()).toBe(true);
    expect(bar.element.style.display).toBe("");
    expect(bar.log).toEqual(["wake"]);
  });

  it("hides the bar, stops updating it and ignores its clicks when off", () => {
    const bar = stubBar();
    const mod = new DashboardButtonsMod(bar);
    const registry = new ModRegistry(memoryStorage());
    registry.register(mod);
    registry.initAll(CTX);
    registry.dispatchUpdate(0.1, {});
    expect(mod.hitAt(500, 290)).toBe("guide");

    registry.toggleMod("dashboard-buttons");
    expect(bar.element.style.display).toBe("none");
    expect(mod.hitAt(500, 290)).toBeNull();
    bar.log.length = 0;
    registry.dispatchUpdate(0.1, {});
    mod.update(0.1, {});
    expect(bar.log).toEqual([]);
  });
});

describe("Mod menu painter", () => {
  const entry = (name: string, enabled: boolean) => ({
    name,
    version: "1.0.0",
    description: "A mod that does one small thing, described at some length to wrap.",
    enabled,
  });

  it("paints a framed card with one row per mod shown", () => {
    const layout = paintModMenu([entry("One", true), entry("Two", false)], 1, 0);
    expect(layout.picture.width).toBe(MENU_WIDTH + 1);
    expect(layout.picture.height).toBe(MENU_HEIGHT + 1);
    expect(layout.rows.map((r) => r.index)).toEqual([0, 1]);
    expect(layout.close.x1).toBeGreaterThan(layout.close.x0);
    // Every pixel of the card is opaque; the corner is the dark frame edge.
    expect(Array.from(layout.picture.rgba.slice(0, 4))).toEqual([0x3e, 0x24, 0x18, 255]);
  });

  it("scrolls the list so the selected mod stays in view", () => {
    expect(scrollOffset(0, 0, 3)).toBe(0);
    expect(scrollOffset(7, 0, 10)).toBe(2);
    expect(scrollOffset(1, 4, 10)).toBe(1);
    expect(scrollOffset(9, 9, 10)).toBe(4);
    const many = Array.from({ length: 10 }, (_, i) => entry(`Mod ${i}`, i % 2 === 0));
    const layout = paintModMenu(many, 7, scrollOffset(7, 0, many.length));
    expect(layout.rows.map((r) => r.index)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("paints an empty registry without rows", () => {
    expect(paintModMenu([], 0, 0).rows).toEqual([]);
  });
});
