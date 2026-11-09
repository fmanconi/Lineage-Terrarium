import { describe, expect, it } from "vitest";
import { ExplorerCctvMod } from "../../src/mods/builtin/explorer-cctv";
import { memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";

describe("ExplorerCctvMod", () => {
  const ctx: ModContext = {
    frame: {} as HTMLElement,
    width: 512,
    height: 300,
    storage: memoryStorage(),
  };

  it("registers metadata with defaultEnabled=true", () => {
    const mod = new ExplorerCctvMod();
    expect(mod.meta.id).toBe("explorer-cctv");
    expect(mod.meta.name).toBe("Explorer & Wildlife CCTV");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("saves and recalls CCTV bookmarks via keyboard", () => {
    const mod = new ExplorerCctvMod();
    mod.init(ctx);
    mod.enable();

    mod.update(0.1, { camX: 120, camY: 80 });

    // Shift + 1 saves current position
    expect(mod.onKey({ key: "1", shiftKey: true } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getBookmark(1)).toEqual({ x: 120, y: 80 });

    // Pan away with W/A/S/D
    expect(mod.onKey({ key: "w", shiftKey: false } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.isFreeRoam()).toBe(true);
    expect(mod.getTargetPosition()?.y).toBe(78);

    // Pressing '1' without Shift recalls the CCTV bookmark
    expect(mod.onKey({ key: "1", shiftKey: false } as unknown as KeyboardEvent)).toBe(true);
    expect(mod.getTargetPosition()).toEqual({ x: 120, y: 80 });
  });

  it("cycles bookmarks in patrol mode", () => {
    const mod = new ExplorerCctvMod();
    mod.init(ctx);
    mod.enable();

    mod.saveBookmark(1, 10, 10);
    mod.saveBookmark(2, 20, 20);

    mod.setPatrolMode(true);
    expect(mod.isPatrolMode()).toBe(true);

    // Update with 19 seconds to trigger next patrol step
    mod.update(19, { camX: 10, camY: 10 });
    expect(mod.getTargetPosition()).toEqual({ x: 20, y: 20 });
  });
});
