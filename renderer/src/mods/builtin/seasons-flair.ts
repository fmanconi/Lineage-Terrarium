/**
 * Seasonal Details Mod (ADR 0024):
 *
 * Enriches the visual transitions between the four seasons:
 *   - Spring: Drifting cherry blossom petals (delicate pink & white) and floating golden pollen.
 *   - Summer: Sunlit warm dust motes and shimmering heat haze motes.
 *   - Autumn: Tumbling leaf-fall cascades in vibrant amber, scarlet and burnt ochre.
 *   - Winter: Soft frost motes and crisp cold atmospheric glints.
 *
 * Fully reactive to wind speed and direction (`atmosphere.wind`).
 * Drawn over the screen (`layers.screen`, 512×300 art pixels) in whole art pixels, dimmed
 * by the light of the moment (`options.light`).
 * Operates purely on client visual layers without affecting sim logic.
 */
import { Graphics } from "pixi.js";
import type { Mod, ModContext, ModLayers, ModMetadata } from "../types";

export type SeasonName = "spring" | "summer" | "autumn" | "winter";

export interface SeasonalParticle {
  id: number;
  x: number; // View coordinates or normalized
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vRot: number;
  colour: number;
  size: number;
  alpha: number;
  ageS: number;
  lifeS: number;
  kind: "petal" | "pollen" | "leaf" | "mote" | "frost";
}

const MAX_SEASONAL_PARTICLES = 120;
/** Wind (`windX`) above which some particles blow in from the upwind side, and how many. */
const SIDE_WIND = 1.2;
const SIDE_SHARE = 0.4;
/** How bright the particles stay in the dark (0–1), and the frost's glint threshold. */
export const NIGHT_FLOOR = 0.35;
const GLINT_FROM = 0.85;

// Palettes for seasonal particles matching Lineage pixel style
export const BLOSSOM_COLOURS = [0xffb7c5, 0xffccd5, 0xfff0f5, 0xfce4ec];
export const POLLEN_COLOURS = [0xfff59d, 0xffe082, 0xffd54f];
export const AUTUMN_COLOURS = [0xd84315, 0xd48817, 0xef6c00, 0x8d6e63, 0xc62828];
export const SUMMER_MOTE_COLOURS = [0xfff9c4, 0xffecb3, 0xffe082];
export const WINTER_FROST_COLOURS = [0xe0f7fa, 0xb2ebf2, 0xe1f5fe, 0xffffff];

let seasonalFlairActive = false;

export function isSeasonalFlairActive(): boolean {
  return seasonalFlairActive;
}

export function setSeasonalFlairActive(active: boolean): void {
  seasonalFlairActive = active;
}

export class SeasonalFlairSystem {
  readonly particles: SeasonalParticle[] = [];
  private currentSeason: SeasonName = "summer";
  private seasonProgress = 0.5; // 0..1 through the season
  private forcedSeason: SeasonName | null = null;
  private spawnAccS = 0;
  private nextId = 1;

  reset(): void {
    this.particles.length = 0;
    this.spawnAccS = 0;
  }

  setClock(season: string, progress: number): void {
    if (season === "spring" || season === "summer" || season === "autumn" || season === "winter") {
      this.currentSeason = season;
    }
    this.seasonProgress = Math.max(0, Math.min(1, progress));
  }

  setForcedSeason(season: SeasonName | null): void {
    this.forcedSeason = season;
  }

  getActiveSeason(): SeasonName {
    return this.forcedSeason ?? this.currentSeason;
  }

  getSeasonProgress(): number {
    return this.seasonProgress;
  }

  getParticles(): readonly SeasonalParticle[] {
    return this.particles;
  }

  /**
   * Spawn rate per second depending on current season.
   */
  spawnRate(): number {
    const s = this.getActiveSeason();
    switch (s) {
      case "spring":
        return 12; // Blossoms & pollen
      case "autumn":
        return 20; // Heavy foliage cascade
      case "summer":
        return 6; // Occasional golden heat motes
      case "winter":
        return 10; // Frost flecks
    }
  }

  private pickColour(season: SeasonName): { colour: number; kind: SeasonalParticle["kind"] } {
    switch (season) {
      case "spring":
        if (Math.random() < 0.65) {
          const c = BLOSSOM_COLOURS[Math.floor(Math.random() * BLOSSOM_COLOURS.length)] ?? 0xffb7c5;
          return { colour: c, kind: "petal" };
        } else {
          const c = POLLEN_COLOURS[Math.floor(Math.random() * POLLEN_COLOURS.length)] ?? 0xffe082;
          return { colour: c, kind: "pollen" };
        }
      case "autumn": {
        const c = AUTUMN_COLOURS[Math.floor(Math.random() * AUTUMN_COLOURS.length)] ?? 0xd84315;
        return { colour: c, kind: "leaf" };
      }
      case "winter": {
        const c =
          WINTER_FROST_COLOURS[Math.floor(Math.random() * WINTER_FROST_COLOURS.length)] ?? 0xffffff;
        return { colour: c, kind: "frost" };
      }
      case "summer":
      default: {
        const c =
          SUMMER_MOTE_COLOURS[Math.floor(Math.random() * SUMMER_MOTE_COLOURS.length)] ?? 0xfff9c4;
        return { colour: c, kind: "mote" };
      }
    }
  }

  spawnParticle(width = 512, height = 300, windX = 1.0, windY = 0.2): void {
    if (this.particles.length >= MAX_SEASONAL_PARTICLES) {
      this.particles.shift();
    }

    const season = this.getActiveSeason();
    const { colour, kind } = this.pickColour(season);

    // Spawn along top or, in a strong wind, the upwind edge's upper part
    const fromSide = Math.abs(windX) > SIDE_WIND && Math.random() < SIDE_SHARE;
    const x = fromSide ? (windX > 0 ? -10 : width + 10) : Math.random() * (width + 60) - 30;
    const y = fromSide ? Math.random() * height * 0.6 : -10;
    const lifeS = 4 + Math.random() * 5;

    // Kinematics based on particle kind
    let vx = (windX * 0.7 + (Math.random() - 0.5) * 0.5) * (kind === "leaf" ? 35 : 20);
    let vy = (kind === "pollen" ? 8 : kind === "leaf" ? 30 : 20) + Math.random() * 15 + windY * 10;
    if (kind === "mote") {
      vx *= 0.3;
      vy *= 0.4;
    }

    this.particles.push({
      id: this.nextId++,
      x,
      y,
      vx,
      vy,
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * (kind === "leaf" ? 4 : 1.5),
      colour,
      size: kind === "pollen" || kind === "mote" ? 1 : kind === "leaf" ? 3 : 2,
      alpha: 0.9,
      ageS: 0,
      lifeS,
      kind,
    });
  }

  update(dtS: number, width = 512, height = 300, windX = 1.0, windY = 0.2): void {
    if (dtS <= 0 || !seasonalFlairActive) return;

    // Spawn logic
    const rate = this.spawnRate();
    this.spawnAccS += dtS;
    const interval = 1 / rate;
    while (this.spawnAccS >= interval) {
      this.spawnParticle(width, height, windX, windY);
      this.spawnAccS -= interval;
    }

    // Step physics
    const survivors: SeasonalParticle[] = [];
    for (const p of this.particles) {
      p.ageS += dtS;

      if (p.ageS < p.lifeS && p.y <= height + 20) {
        // Flutter/turbulence
        const wobble = Math.sin(p.ageS * 3 + p.id) * 8;
        p.x += (p.vx + wobble) * dtS;
        p.y += p.vy * dtS;
        p.rotation += p.vRot * dtS;

        // Soft fade near end of life
        const remaining = p.lifeS - p.ageS;
        if (remaining < 1.0) {
          p.alpha = Math.max(0, remaining);
        }

        survivors.push(p);
      }
    }
    this.particles.length = 0;
    this.particles.push(...survivors);
  }
}

export const seasonalFlairSystem = new SeasonalFlairSystem();

export class SeasonalFlairMod implements Mod {
  readonly meta: ModMetadata = {
    id: "seasons-flair",
    name: "Seasonal Details",
    version: "1.0.0",
    description: "Falling leaves in autumn, petals in spring, warmer light in summer.",
    defaultEnabled: true,
  };

  /** The particles over the screen, in art pixels. */
  private readonly canvas = new Graphics();
  readonly layers: ModLayers = { screen: this.canvas };
  private width = 512;
  private height = 300;

  init(ctx: ModContext): void {
    this.width = ctx.width;
    this.height = ctx.height;
    this.canvas.visible = false;
  }

  enable(): void {
    setSeasonalFlairActive(true);
  }

  disable(): void {
    setSeasonalFlairActive(false);
    seasonalFlairSystem.reset();
    this.canvas.clear();
    this.canvas.visible = false;
  }

  isEnabled(): boolean {
    return isSeasonalFlairActive();
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!seasonalFlairActive) return;

    if (typeof options.season === "string") {
      const progress = typeof options.seasonProgress === "number" ? options.seasonProgress : 0.5;
      seasonalFlairSystem.setClock(options.season, progress);
    }

    const windX = typeof options.windX === "number" ? options.windX : 1.0;
    const windY = typeof options.windY === "number" ? options.windY : 0.2;
    seasonalFlairSystem.update(dtS, this.width, this.height, windX, windY);

    const light = typeof options.light === "number" ? Math.max(0, Math.min(1, options.light)) : 1;
    this.draw(NIGHT_FLOOR + (1 - NIGHT_FLOOR) * light);
  }

  /** Every particle in whole art pixels, its shape by kind, its alpha times `lit`. */
  private draw(lit: number): void {
    const g = this.canvas;
    g.clear();
    g.visible = true;
    for (const p of seasonalFlairSystem.getParticles()) {
      const alpha = p.alpha * lit;
      if (alpha <= 0) continue;
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      const fill = { color: p.colour, alpha };
      switch (p.kind) {
        case "petal":
          // Two pixels, lying or standing as it turns
          if (Math.abs(Math.cos(p.rotation)) > 0.5) g.rect(x, y, 2, 1).fill(fill);
          else g.rect(x, y, 1, 2).fill(fill);
          break;
        case "leaf": {
          // Three pixels of a 2×2 square, the missing corner turning with the leaf
          const corner = Math.floor(((p.rotation % TAU) + TAU) / (TAU / 4)) % 4;
          for (let k = 0; k < 4; k++) {
            if (k === corner) continue;
            g.rect(x + (k % 2), y + Math.floor(k / 2), 1, 1).fill(fill);
          }
          break;
        }
        case "frost":
          g.rect(x, y, 1, 1).fill(fill);
          // Now and then a glint: a faint cross round the fleck
          if (Math.sin(p.ageS * 6 + p.id) > GLINT_FROM) {
            const arm = { color: p.colour, alpha: alpha * 0.5 };
            g.rect(x - 1, y, 1, 1).fill(arm);
            g.rect(x + 1, y, 1, 1).fill(arm);
            g.rect(x, y - 1, 1, 1).fill(arm);
            g.rect(x, y + 1, 1, 1).fill(arm);
          }
          break;
        case "pollen":
        case "mote":
          g.rect(x, y, 1, 1).fill(fill);
          break;
      }
    }
  }
}

const TAU = Math.PI * 2;
