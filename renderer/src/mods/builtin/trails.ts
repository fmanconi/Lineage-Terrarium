/**
 * Footprints & Game Trails Mod (ADR 0024):
 *
 * Simulates transient creature footprints on soil and accumulates long-term "game trails"
 * (beaten paths) across heavily traveled migration corridors.
 *
 * 1. Footprints: Individual steps leave subtle paw/hoof marks that fade over 3-6 seconds.
 * 2. Beaten Paths: Repeated animal transit on grassland/soil wears down vegetation, creating
 *    visible dirt trails that connect common grazing and watering areas.
 * 3. Rain & Regrowth: Heavy rain accelerates trail erosion, while natural plant succession
 *    slowly reclaims abandoned trails.
 *
 * Drawn on the ground of the view shown (`layers.ground`, in cells), under its plants and
 * animals: the paths as worn soil, the prints as single art pixels that fade.
 *
 * Renderer-only: zero impact on `sim/` determinism or server saves.
 */
import { Container, Graphics } from "pixi.js";
import type { Land } from "../../terrain/land";
import type { Mod, ModLayers, ModMetadata } from "../types";

export const TRAIL_GRID_SIZE = 128;
export const TRAIL_THRESHOLD = 8.0;
export const MAX_TRAIL_WEAR = 30.0;
export const FOOTPRINT_TTL_S = 4.5;
export const MAX_FOOTPRINTS = 256;
/** Squared cells an animal may move between two frames and still be walking. */
export const MAX_STRIDE_SQ = 4;
/** Wear (in steps) from which a cell starts to show as worn, and the path's darkest alpha. */
export const TRAIL_SHOWN_FROM = 3;
export const TRAIL_MAX_ALPHA = 0.45;
/** The footprints' darkest alpha, when just made. */
export const FOOTPRINT_ALPHA = 0.6;
/** How often the beaten paths are drawn again, seconds (they change slowly). */
export const TRAIL_REDRAW_S = 0.5;
/** Bare trodden soil, and the darker earth of a fresh print. */
export const TRAIL_COLOUR = 0x9a7a52;
export const FOOTPRINT_COLOUR = 0x5a4430;

export interface Footprint {
  id: number;
  x: number;
  y: number;
  heading: number;
  ageS: number;
  maxAgeS: number;
  side: -1 | 1; // Left or right step
}

let trailsActive = false;

export function isTrailsActive(): boolean {
  return trailsActive;
}

export function setTrailsActive(active: boolean): void {
  trailsActive = active;
}

export class TrailSystem {
  // Wear grid tracking cumulative steps per cell: 128×128 until it is told the world's size
  wear = new Float32Array(TRAIL_GRID_SIZE * TRAIL_GRID_SIZE);
  width = TRAIL_GRID_SIZE;
  height = TRAIL_GRID_SIZE;
  private readonly footprints: Footprint[] = [];
  private lastPositions = new Map<number, { x: number; y: number; stepCount: number }>();
  private nextFootprintId = 1;

  reset(): void {
    this.wear.fill(0);
    this.footprints.length = 0;
    this.lastPositions.clear();
  }

  /** Fit the wear grid to a world of `width` × `height` cells (a new world starts unworn). */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.wear = new Float32Array(width * height);
    this.reset();
  }

  /**
   * Observe animal positions for the current frame, spawning footprints and recording wear.
   */
  observe(
    animals: readonly { id: number; x: number; y: number; heading?: number }[],
    onLand?: (x: number, y: number) => boolean,
  ): void {
    if (!trailsActive) return;

    for (const animal of animals) {
      const prev = this.lastPositions.get(animal.id);
      if (!prev) {
        this.lastPositions.set(animal.id, { x: animal.x, y: animal.y, stepCount: 0 });
        continue;
      }

      const dx = animal.x - prev.x;
      const dy = animal.y - prev.y;
      const distSq = dx * dx + dy * dy;

      // Farther than a stride: the animal was placed anew (another view), not walking
      if (distSq > MAX_STRIDE_SQ) {
        prev.x = animal.x;
        prev.y = animal.y;
        continue;
      }

      // Distance threshold: ~0.35 cells between steps
      if (distSq >= 0.12) {
        prev.x = animal.x;
        prev.y = animal.y;
        prev.stepCount++;
        // Wading or swimming leaves nothing behind
        if (onLand !== undefined && !onLand(animal.x, animal.y)) continue;

        const heading = animal.heading ?? Math.atan2(dy, dx);
        const side = prev.stepCount % 2 === 0 ? 1 : -1;

        // Offset footprint slightly perpendicular to heading for natural biped/quadruped look
        const perp = heading + Math.PI / 2;
        const offset = 0.08 * side;
        const fx = animal.x + Math.cos(perp) * offset;
        const fy = animal.y + Math.sin(perp) * offset;

        this.addFootprint(fx, fy, heading, side);
        this.addWear(animal.x, animal.y, 1.0);
      }
    }

    // Garbage collect positions of animals that no longer exist
    if (this.lastPositions.size > animals.length * 2) {
      const currentIds = new Set(animals.map((a) => a.id));
      for (const id of this.lastPositions.keys()) {
        if (!currentIds.has(id)) {
          this.lastPositions.delete(id);
        }
      }
    }
  }

  addFootprint(x: number, y: number, heading: number, side: -1 | 1): void {
    if (this.footprints.length >= MAX_FOOTPRINTS) {
      this.footprints.shift();
    }
    this.footprints.push({
      id: this.nextFootprintId++,
      x,
      y,
      heading,
      ageS: 0,
      maxAgeS: FOOTPRINT_TTL_S,
      side,
    });
  }

  addWear(x: number, y: number, amount: number): void {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx >= 0 && gx < this.width && gy >= 0 && gy < this.height) {
      const idx = gy * this.width + gx;
      const current = this.wear[idx] ?? 0;
      this.wear[idx] = Math.min(MAX_TRAIL_WEAR, current + amount);
    }
  }

  getWear(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return 0;
    return this.wear[gy * this.width + gx] ?? 0;
  }

  isBeatenPath(gx: number, gy: number): boolean {
    return this.getWear(gx, gy) >= TRAIL_THRESHOLD;
  }

  getFootprints(): readonly Footprint[] {
    return this.footprints;
  }

  /**
   * Advance time: decay footprints and fade wear based on rain and natural vegetation regrowth.
   */
  update(dtS: number, rain = 0): void {
    if (dtS <= 0) return;

    // 1. Footprint aging
    const kept: Footprint[] = [];
    for (const fp of this.footprints) {
      fp.ageS += dtS;
      if (fp.ageS < fp.maxAgeS) {
        kept.push(fp);
      }
    }
    this.footprints.length = 0;
    this.footprints.push(...kept);

    // 2. Wear decay
    // Base natural soil recovery: 0.01 per second (~15 mins to heal a heavy trail)
    // Rain wash: up to 0.08 additional per second during heavy storms
    const decayRate = (0.01 + Math.max(0, rain) * 0.08) * dtS;
    for (let i = 0; i < this.wear.length; i++) {
      const current = this.wear[i] ?? 0;
      if (current > 0) {
        this.wear[i] = Math.max(0, current - decayRate);
      }
    }
  }
}

export const trailSystem = new TrailSystem();

export class FootprintsTrailsMod implements Mod {
  readonly meta: ModMetadata = {
    id: "footprints-trails",
    name: "Footprints & Game Trails",
    version: "1.0.0",
    description:
      "Animals leave transient footprints and wear visible dirt trails along heavily traveled migration routes.",
    defaultEnabled: true,
  };

  /** On the ground, in cells: the beaten paths under the footprints. */
  private readonly ground = new Container();
  private readonly paths = new Graphics();
  private readonly prints = new Graphics();
  readonly layers: ModLayers = { ground: this.ground };
  private sincePathsS = Infinity;

  constructor() {
    this.ground.addChild(this.paths, this.prints);
    this.ground.visible = false;
  }

  init(): void {
    // Nothing to set up: the layers are mounted by the scene.
  }

  enable(): void {
    setTrailsActive(true);
    this.sincePathsS = Infinity;
  }

  disable(): void {
    setTrailsActive(false);
    trailSystem.reset();
    this.ground.visible = false;
    this.paths.clear();
    this.prints.clear();
  }

  isEnabled(): boolean {
    return isTrailsActive();
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!trailsActive) return;

    const land = landOf(options.land);
    if (land !== null) trailSystem.resize(land.width, land.height);
    const rain = typeof options.rain === "number" ? options.rain : 0;
    trailSystem.update(dtS, rain);

    if (Array.isArray(options.animals)) {
      const onLand =
        land === null
          ? undefined
          : (x: number, y: number): boolean =>
              (land.heights[Math.floor(y) * land.width + Math.floor(x)] ?? 0) > land.seaLevel;
      trailSystem.observe(
        options.animals as { id: number; x: number; y: number; heading?: number }[],
        onLand,
      );
    }

    const tile = typeof options.tile === "number" && options.tile > 0 ? options.tile : 1;
    this.ground.visible = true;
    this.sincePathsS += dtS;
    if (this.sincePathsS >= TRAIL_REDRAW_S) {
      this.sincePathsS = 0;
      this.drawPaths();
    }
    // The prints are too small to see on the map
    this.drawPrints(options.view === "map" ? 0 : tile);
  }

  /** The worn cells, in three steps of bare soil as the wear deepens. */
  private drawPaths(): void {
    const g = this.paths;
    g.clear();
    const { width, height } = trailSystem;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const wear = trailSystem.wear[y * width + x] ?? 0;
        if (wear < TRAIL_SHOWN_FROM) continue;
        const step = wear >= MAX_TRAIL_WEAR / 2 ? 3 : wear >= TRAIL_THRESHOLD ? 2 : 1;
        g.rect(x, y, 1, 1).fill({ color: TRAIL_COLOUR, alpha: (TRAIL_MAX_ALPHA * step) / 3 });
      }
    }
  }

  /** Each print as a whole art pixel or two (`tile` art pixels to the cell; 0 for none). */
  private drawPrints(tile: number): void {
    const g = this.prints;
    g.clear();
    if (tile <= 0) return;
    // One art pixel in the middle view, a 2×2 hoof in the local view
    const size = (tile >= 16 ? 2 : 1) / tile;
    for (const fp of trailSystem.getFootprints()) {
      const fade = 1 - fp.ageS / fp.maxAgeS;
      if (fade <= 0) continue;
      const x = Math.floor(fp.x * tile) / tile;
      const y = Math.floor(fp.y * tile) / tile;
      g.rect(x, y, size, size).fill({ color: FOOTPRINT_COLOUR, alpha: FOOTPRINT_ALPHA * fade });
    }
  }
}

/** The land of `options.land`, if it is one (its size, heights and sea level). */
function landOf(value: unknown): Pick<Land, "width" | "height" | "heights" | "seaLevel"> | null {
  if (typeof value !== "object" || value === null) return null;
  const land = value as Partial<Land>;
  if (
    typeof land.width !== "number" ||
    typeof land.height !== "number" ||
    typeof land.seaLevel !== "number" ||
    !(land.heights instanceof Float32Array)
  ) {
    return null;
  }
  return { width: land.width, height: land.height, heights: land.heights, seaLevel: land.seaLevel };
}
