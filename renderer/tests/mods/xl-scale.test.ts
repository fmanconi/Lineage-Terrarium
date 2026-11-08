import { beforeEach, describe, expect, it } from "vitest";
import {
  XL_SCALE_STORAGE_KEY,
  XlScaleMod,
  cycleZoom,
  formatMetricSize,
  isXlScaleActive,
  setXlScaleActive,
  stepZoom,
} from "../../src/mods/builtin/xl-scale";
import { memoryStorage } from "../../src/mods/registry";
import type { StorageLike } from "../../src/settings";

const key = (k: string): KeyboardEvent => ({ key: k }) as KeyboardEvent;

/** A mod initialised on `storage`, switched on and told the view shown is `view`. */
function modIn(view: string, storage: StorageLike = memoryStorage()): XlScaleMod {
  const mod = new XlScaleMod();
  mod.init({ frame: {} as HTMLElement, width: 512, height: 300, storage });
  mod.enable();
  mod.update(0.016, { view });
  return mod;
}

describe("Terrarium XL: Macro Zoom & Apex Ecology", () => {
  beforeEach(() => {
    setXlScaleActive(false);
  });

  it("registers its metadata", () => {
    const mod = new XlScaleMod();
    expect(mod.meta.id).toBe("xl-scale");
    expect(mod.meta.name).toBe("Terrarium XL: Macro Zoom & Apex Ecology");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("enables and disables the global flag", () => {
    const mod = new XlScaleMod();
    expect(mod.isEnabled()).toBe(false);
    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isXlScaleActive()).toBe(true);
    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isXlScaleActive()).toBe(false);
  });

  it("cycles the zoom 1x → 2x → 3x → 4x → 1x", () => {
    expect(cycleZoom(1)).toBe(2);
    expect(cycleZoom(2)).toBe(3);
    expect(cycleZoom(3)).toBe(4);
    expect(cycleZoom(4)).toBe(1);
  });

  it("steps the zoom with the wheel, within 1x and 4x", () => {
    expect(stepZoom(1, -100)).toBe(2);
    expect(stepZoom(2, -100)).toBe(3);
    expect(stepZoom(3, -100)).toBe(4);
    expect(stepZoom(4, -100)).toBe(4);
    expect(stepZoom(4, 100)).toBe(3);
    expect(stepZoom(3, 100)).toBe(2);
    expect(stepZoom(2, 100)).toBe(1);
    expect(stepZoom(1, 100)).toBe(1);
    expect(stepZoom(2, 0)).toBe(2);
  });

  it("zooms with Z in the local view only", () => {
    const mod = modIn("local");
    expect(mod.onKey(key("z"))).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(2);
    expect(mod.onKey(key("Z"))).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(3);
    expect(mod.onKey(key("z"))).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(4);
    expect(mod.onKey(key("z"))).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(1);
    expect(mod.onKey(key("x"))).toBe(false);

    mod.update(0.016, { view: "middle" });
    expect(mod.onKey(key("z"))).toBe(false);
    expect(mod.macroZoomLevel).toBe(1);
  });

  it("draws other views, and every view with the mod off, at 1x", () => {
    const mod = modIn("local");
    mod.onKey(key("z"));
    expect(mod.macroZoomFor("map")).toBe(1);
    expect(mod.macroZoomFor("middle")).toBe(1);
    mod.disable();
    expect(mod.macroZoomFor("local")).toBe(1);
    expect(mod.onKey(key("z"))).toBe(false);
    expect(mod.onWheel(-100, "local")).toBe(false);
    // The level chosen comes back when the mod does.
    mod.enable();
    expect(mod.macroZoomFor("local")).toBe(2);
  });

  it("zooms with the wheel in the local view only", () => {
    const mod = modIn("local");
    expect(mod.onWheel(-120, "local")).toBe(true);
    expect(mod.onWheel(-120, "local")).toBe(true);
    expect(mod.onWheel(-120, "local")).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(4);
    expect(mod.onWheel(120, "middle")).toBe(false);
    expect(mod.onWheel(0, "local")).toBe(false);
    expect(mod.onWheel(120, "local")).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(3);
    expect(mod.onWheel(120, "local")).toBe(true);
    expect(mod.macroZoomFor("local")).toBe(2);
  });

  it("keeps the zoom level across runs", () => {
    const storage = memoryStorage();
    const first = modIn("local", storage);
    first.onKey(key("z"));
    first.onKey(key("z"));
    first.onKey(key("z"));
    expect(storage.getItem(XL_SCALE_STORAGE_KEY)).toBe("4");
    const second = modIn("local", storage);
    expect(second.macroZoomLevel).toBe(4);
  });

  it("starts at 1x from a missing or unreadable stored level", () => {
    const storage = memoryStorage();
    storage.setItem(XL_SCALE_STORAGE_KEY, "banana");
    expect(modIn("local", storage).macroZoomLevel).toBe(1);
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const mod = modIn("local", refusing);
    expect(mod.macroZoomLevel).toBe(1);
    expect(mod.onKey(key("z"))).toBe(true);
    expect(mod.macroZoomLevel).toBe(2);
  });

  it("classes a species' size from its mass", () => {
    expect(formatMetricSize(0.08)).toBe("Micro (15-28 cm, ~120g)");
    expect(formatMetricSize(0.34)).toBe("Micro (15-28 cm, ~120g)");
    expect(formatMetricSize(0.35)).toBe("Small (35-60 cm, ~2kg)");
    expect(formatMetricSize(1.49)).toBe("Small (35-60 cm, ~2kg)");
    expect(formatMetricSize(1.5)).toBe("Medium (75-120 cm, ~25kg)");
    expect(formatMetricSize(5.99)).toBe("Medium (75-120 cm, ~25kg)");
    expect(formatMetricSize(6.0)).toBe("Apex (1.5-2.2 m, ~95kg)");
    expect(formatMetricSize(32)).toBe("Apex (1.5-2.2 m, ~95kg)");
  });
});
