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
 * Renderer-only: zero impact on `sim/` determinism or server saves.
 */
import type { Mod, ModContext, ModMetadata } from "../types";

export const TRAIL_GRID_SIZE = 128;
export const TRAIL_THRESHOLD = 8.0;
export const MAX_TRAIL_WEAR = 30.0;
export const FOOTPRINT_TTL_S = 4.5;
export const MAX_FOOTPRINTS = 256;

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
  // 128x128 wear grid tracking cumulative steps per cell
  readonly wear = new Float32Array(TRAIL_GRID_SIZE * TRAIL_GRID_SIZE);
  private readonly footprints: Footprint[] = [];
  private lastPositions = new Map<number, { x: number; y: number; stepCount: number }>();
  private nextFootprintId = 1;

  reset(): void {
    this.wear.fill(0);
    this.footprints.length = 0;
    this.lastPositions.clear();
  }

  /**
   * Observe animal positions for the current frame, spawning footprints and recording wear.
   */
  observe(animals: readonly { id: number; x: number; y: number; heading?: number }[]): void {
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

      // Distance threshold: ~0.35 cells between steps
      if (distSq >= 0.12) {
        prev.x = animal.x;
        prev.y = animal.y;
        prev.stepCount++;

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
    if (gx >= 0 && gx < TRAIL_GRID_SIZE && gy >= 0 && gy < TRAIL_GRID_SIZE) {
      const idx = gy * TRAIL_GRID_SIZE + gx;
      const current = this.wear[idx] ?? 0;
      this.wear[idx] = Math.min(MAX_TRAIL_WEAR, current + amount);
    }
  }

  getWear(gx: number, gy: number): number {
    if (gx < 0 || gx >= TRAIL_GRID_SIZE || gy < 0 || gy >= TRAIL_GRID_SIZE) return 0;
    return this.wear[gy * TRAIL_GRID_SIZE + gx] ?? 0;
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

  init(_ctx: ModContext): void {
    // Initialised and ready
  }

  enable(): void {
    setTrailsActive(true);
  }

  disable(): void {
    setTrailsActive(false);
    trailSystem.reset();
  }

  isEnabled(): boolean {
    return isTrailsActive();
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!trailsActive) return;

    const rain = typeof options.rain === "number" ? options.rain : 0;
    trailSystem.update(dtS, rain);

    if (Array.isArray(options.animals)) {
      trailSystem.observe(options.animals as { id: number; x: number; y: number; heading?: number }[]);
    }
  }
}
