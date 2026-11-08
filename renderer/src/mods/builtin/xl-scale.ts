/**
 * Terrarium XL: Macro Zoom & Apex Ecology Mod (ADR 0024):
 *
 * 1. Macro zoom: in the local view (the animal followed), `Z` or the mouse wheel brings the
 *    camera in to 2×, 3× and 4×, centred on the shot's middle, so that the smallest animals can
 *    be seen pixel by pixel. `main.ts` reads the level (`macroZoomFor`) and scales the
 *    world by it; the art itself is not redrawn, only magnified.
 * 2. Ecological scale: the field guide gives each species a size class in centimetres and
 *    kilograms from its mass (`formatMetricSize`), shown while the mod is on.
 *
 * The wider range of masses (15 cm critters to apex predators) is the terrarium's config
 * (`sim/config/terrarium.toml`, `mass_min`, `mass_max`), not this mod's: the renderer
 * only draws what the sim decides.
 *
 * Renderer-only: zero impact on `sim/` determinism or server saves.
 */
import type { StorageLike } from "../../settings";
import type { Mod, ModContext, ModMetadata } from "../types";

export type MacroZoomLevel = 1 | 2 | 3 | 4;

/** Where the zoom level is kept between runs. */
export const XL_SCALE_STORAGE_KEY = "lineage_xl_scale_zoom_v1";

/** Mass bounds (sim mass units) of the field guide's size classes. */
export const MICRO_MASS_MAX = 0.35;
export const SMALL_MASS_MAX = 1.5;
export const MEDIUM_MASS_MAX = 6.0;

let xlScaleActive = false;

export function setXlScaleActive(active: boolean): void {
  xlScaleActive = active;
}

export function isXlScaleActive(): boolean {
  return xlScaleActive;
}

/** The next level when `Z` is pressed: 1× → 2× → 3× → 4× → 1×. */
export function cycleZoom(level: MacroZoomLevel): MacroZoomLevel {
  return level === 1 ? 2 : level === 2 ? 3 : level === 3 ? 4 : 1;
}

/** One wheel notch: forward (`deltaY < 0`) zooms in up to 4×, back zooms out down to 1×. */
export function stepZoom(level: MacroZoomLevel, deltaY: number): MacroZoomLevel {
  if (deltaY < 0) return level === 1 ? 2 : level === 2 ? 3 : 4;
  if (deltaY > 0) return level === 4 ? 3 : level === 3 ? 2 : 1;
  return level;
}

/** A species' size class, in centimetres and kilograms, from its mass. */
export function formatMetricSize(mass: number): string {
  if (mass < MICRO_MASS_MAX) return "Micro (15-28 cm, ~120g)";
  if (mass < SMALL_MASS_MAX) return "Small (35-60 cm, ~2kg)";
  if (mass < MEDIUM_MASS_MAX) return "Medium (75-120 cm, ~25kg)";
  return "Apex (1.5-2.2 m, ~95kg)";
}

function parseLevel(raw: string | null): MacroZoomLevel {
  return raw === "2" ? 2 : raw === "3" ? 3 : raw === "4" ? 4 : 1;
}

export class XlScaleMod implements Mod {
  readonly meta: ModMetadata = {
    id: "xl-scale",
    name: "Terrarium XL: Macro Zoom & Apex Ecology",
    version: "1.0.0",
    description:
      "Deep macro zoom (key [Z] or wheel) and ecological scale from 15cm micro-critters to massive apex predators.",
    defaultEnabled: true,
  };

  private level: MacroZoomLevel = 1;
  private view: string | null = null;
  private storage: StorageLike | null = null;

  init(ctx: ModContext): void {
    this.storage = ctx.storage;
    try {
      this.level = parseLevel(ctx.storage.getItem(XL_SCALE_STORAGE_KEY));
    } catch {
      this.level = 1;
    }
  }

  enable(): void {
    setXlScaleActive(true);
  }

  disable(): void {
    setXlScaleActive(false);
  }

  isEnabled(): boolean {
    return isXlScaleActive();
  }

  /** The level chosen, whatever the view. */
  get macroZoomLevel(): MacroZoomLevel {
    return this.level;
  }

  /** The zoom to draw `view` at: the level in the local view while the mod is on, else 1. */
  macroZoomFor(view: string): MacroZoomLevel {
    return xlScaleActive && view === "local" ? this.level : 1;
  }

  update(_dtS: number, options: Record<string, unknown>): void {
    this.view = typeof options.view === "string" ? options.view : null;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key !== "z" && e.key !== "Z") return false;
    if (!xlScaleActive || this.view !== "local") return false;
    this.setLevel(cycleZoom(this.level));
    return true;
  }

  /** A wheel turn over the scene; `true` if it zoomed (in the local view, mod on). */
  onWheel(deltaY: number, view: string): boolean {
    if (!xlScaleActive || view !== "local" || deltaY === 0) return false;
    this.setLevel(stepZoom(this.level, deltaY));
    return true;
  }

  private setLevel(level: MacroZoomLevel): void {
    if (level === this.level) return;
    this.level = level;
    try {
      this.storage?.setItem(XL_SCALE_STORAGE_KEY, String(level));
    } catch {
      // A refused storage keeps the level for this run only.
    }
  }
}
