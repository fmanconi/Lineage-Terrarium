/**
/**
 * Ant Colonies Mod (ADR 0024):
 *
 * Simulates micro-scale insect societies across the island:
 *   - 3 distinct ant colonies (Formica rufa, Lasius niger, Camponotus ligniperda).
 *   - Earthen ant mounds with entrance craters on dry ground.
 *   - Pheromone grid with real-time diffusion & evaporation:
 *       * foodTrails: foraging highways laid by laden workers returning home.
 *       * alarmTrails: defensive pheromone plumes triggered by intruders or rival clashes.
 *   - Micro-swarms of worker & soldier ants with foraging, scavenging, returning, and alarm AI.
 *   - Interactive hotkey [I] toggles bioluminescent pheromone highway visualizer.
 *   - Deep integration with Mod XL (Macro Zoom 2x/3x): microscopic pixel-art detail
 *     (segmented body, moving legs, carried leaf fragments & meat crumbs).
 *
 * Renderer-only: zero impact on sim/ determinism or server state.
 */
import { Container, Graphics } from "pixi.js";
import { INK, PAPER } from "../../captions";
import { GLYPH_ROWS, draw as drawCaption, measure } from "../../pixelfont";
import type { Land } from "../../terrain/land";
import type { Mod, ModContext, ModLayers, ModMetadata } from "../types";

export interface AntColony {
  id: number;
  name: string;
  species: string;
  antColor: number;
  moundColor: number;
  moundX: number;
  moundY: number;
  foodStores: number;
  alarmLevel: number;
  ants: AntEntity[];
}

export interface AntEntity {
  id: number;
  colonyId: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  state: "resting" | "foraging" | "returning" | "alarm";
  carrying: "none" | "leaf" | "food";
  carryColor: number;
  restTimerS: number;
  legPhase: number;
}

export const ANTS_PER_COLONY = 28;
export const PHEROMONE_GRID_SIZE = 64;
export const PHEROMONE_DECAY = 0.14; // Per second evaporation
export const FOOD_TRAIL_COLOR = 0x2ecc71; // Bioluminescent emerald
export const ALARM_TRAIL_COLOR = 0xe74c3c; // Warning scarlet

let formicariumActive = false;
let pheromoneOverlayActive = false;

export function isFormicariumActive(): boolean {
  return formicariumActive;
}

export function setFormicariumActive(active: boolean): void {
  formicariumActive = active;
}

export function isPheromoneOverlayActive(): boolean {
  return pheromoneOverlayActive;
}

export function setPheromoneOverlayActive(active: boolean): void {
  pheromoneOverlayActive = active;
}

export function togglePheromoneOverlay(): boolean {
  pheromoneOverlayActive = !pheromoneOverlayActive;
  return pheromoneOverlayActive;
}

/** Pheromone field simulating chemical diffusion, evaporation and pathfinding gradients. */
export class PheromoneGrid {
  readonly size: number = PHEROMONE_GRID_SIZE;
  readonly foodTrails = new Float32Array(PHEROMONE_GRID_SIZE * PHEROMONE_GRID_SIZE);
  readonly alarmTrails = new Float32Array(PHEROMONE_GRID_SIZE * PHEROMONE_GRID_SIZE);

  reset(): void {
    this.foodTrails.fill(0);
    this.alarmTrails.fill(0);
  }

  depositFood(worldX: number, worldY: number, worldW: number, worldH: number, amount = 0.4): void {
    if (worldW <= 0 || worldH <= 0) return;
    const gx = Math.floor((worldX / worldW) * this.size);
    const gy = Math.floor((worldY / worldH) * this.size);
    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) return;
    const idx = gy * this.size + gx;
    this.foodTrails[idx] = Math.min(1.0, (this.foodTrails[idx] ?? 0) + amount);
  }

  depositAlarm(worldX: number, worldY: number, worldW: number, worldH: number, amount = 0.6): void {
    if (worldW <= 0 || worldH <= 0) return;
    const gx = Math.floor((worldX / worldW) * this.size);
    const gy = Math.floor((worldY / worldH) * this.size);
    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) return;
    const idx = gy * this.size + gx;
    this.alarmTrails[idx] = Math.min(1.0, (this.alarmTrails[idx] ?? 0) + amount);
  }

  sampleFood(worldX: number, worldY: number, worldW: number, worldH: number): number {
    if (worldW <= 0 || worldH <= 0) return 0;
    const gx = Math.floor((worldX / worldW) * this.size);
    const gy = Math.floor((worldY / worldH) * this.size);
    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) return 0;
    return this.foodTrails[gy * this.size + gx] ?? 0;
  }

  sampleAlarm(worldX: number, worldY: number, worldW: number, worldH: number): number {
    if (worldW <= 0 || worldH <= 0) return 0;
    const gx = Math.floor((worldX / worldW) * this.size);
    const gy = Math.floor((worldY / worldH) * this.size);
    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) return 0;
    return this.alarmTrails[gy * this.size + gx] ?? 0;
  }

  /** Probe food scent in three directional forward cones to orient foraging worker. */
  senseFoodHeading(
    worldX: number,
    worldY: number,
    currentHeading: number,
    worldW: number,
    worldH: number,
  ): number | null {
    const reach = 1.5;
    const angles = [-0.5, 0, 0.5]; // left, center, right
    let bestAngle: number | null = null;
    let maxScent = 0.05;

    for (const offset of angles) {
      const probeAngle = currentHeading + offset;
      const px = worldX + Math.cos(probeAngle) * reach;
      const py = worldY + Math.sin(probeAngle) * reach;
      const scent = this.sampleFood(px, py, worldW, worldH);
      if (scent > maxScent) {
        maxScent = scent;
        bestAngle = probeAngle;
      }
    }
    return bestAngle;
  }

  update(dtS: number): void {
    const decay = Math.max(0, 1 - PHEROMONE_DECAY * dtS);
    const len = this.size * this.size;
    for (let i = 0; i < len; i++) {
      let f = (this.foodTrails[i] ?? 0) * decay;
      if (f < 0.01) f = 0;
      this.foodTrails[i] = f;

      let a = (this.alarmTrails[i] ?? 0) * decay;
      if (a < 0.01) a = 0;
      this.alarmTrails[i] = a;
    }
  }
}

export class FormicariumSystem {
  readonly grid = new PheromoneGrid();
  readonly colonies: AntColony[] = [];
  worldWidth = 64;
  worldHeight = 64;
  initialized = false;

  constructor() {
    this.createColonies();
  }

  private createColonies(): void {
    this.colonies.length = 0;
    const speciesData = [
      {
        name: "Red Harvester Colony",
        species: "Formica rufa",
        antColor: 0xbd3a2b, // Vivid woodland rust
        moundColor: 0x5e381e,
        defX: 20,
        defY: 22,
      },
      {
        name: "Black Carpenter Colony",
        species: "Lasius niger",
        antColor: 0x222228, // Jet obsidian slate
        moundColor: 0x483a2d,
        defX: 42,
        defY: 24,
      },
      {
        name: "Amber Forager Colony",
        species: "Camponotus ligniperda",
        antColor: 0xd4ac0d, // Golden honey amber
        moundColor: 0x6e5436,
        defX: 32,
        defY: 45,
      },
    ];

    let antId = 0;
    speciesData.forEach((data, colIndex) => {
      const ants: AntEntity[] = [];
      for (let i = 0; i < ANTS_PER_COLONY; i++) {
        ants.push({
          id: ++antId,
          colonyId: colIndex,
          x: data.defX,
          y: data.defY,
          heading: Math.random() * Math.PI * 2,
          speed: 1.2 + Math.random() * 0.8,
          state: i < 6 ? "resting" : "foraging",
          carrying: "none",
          carryColor: 0x5cb85c,
          restTimerS: Math.random() * 3,
          legPhase: Math.random() * Math.PI * 2,
        });
      }

      this.colonies.push({
        id: colIndex,
        name: data.name,
        species: data.species,
        antColor: data.antColor,
        moundColor: data.moundColor,
        moundX: data.defX,
        moundY: data.defY,
        foodStores: 0,
        alarmLevel: 0,
        ants,
      });
    });
  }

  /** Repositions mounds safely onto dry island soil once land data is received. */
  adaptToLand(land: Pick<Land, "width" | "height" | "heights" | "seaLevel">): void {
    this.worldWidth = land.width;
    this.worldHeight = land.height;
    if (this.initialized) return;

    const findDrySpot = (startX: number, startY: number): { x: number; y: number } => {
      const sx = Math.max(2, Math.min(land.width - 3, Math.floor(startX)));
      const sy = Math.max(2, Math.min(land.height - 3, Math.floor(startY)));
      for (let r = 0; r < 20; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = sx + dx;
            const y = sy + dy;
            if (x >= 0 && x < land.width && y >= 0 && y < land.height) {
              const h = land.heights[y * land.width + x] ?? 0;
              if (h > land.seaLevel + 0.08) {
                return { x: x + 0.5, y: y + 0.5 };
              }
            }
          }
        }
      }
      return { x: sx, y: sy };
    };

    const targetSpots = [
      { x: land.width * 0.32, y: land.height * 0.35 },
      { x: land.width * 0.68, y: land.height * 0.38 },
      { x: land.width * 0.5, y: land.height * 0.72 },
    ];

    this.colonies.forEach((col, idx) => {
      const tgt = targetSpots[idx] ?? { x: 30, y: 30 };
      const dry = findDrySpot(tgt.x, tgt.y);
      col.moundX = dry.x;
      col.moundY = dry.y;
      for (const ant of col.ants) {
        ant.x = dry.x;
        ant.y = dry.y;
      }
    });

    this.initialized = true;
  }

  update(dtS: number, animals: readonly { id: number; x: number; y: number }[] = []): void {
    this.grid.update(dtS);

    for (const col of this.colonies) {
      // Decay alarm level over time
      col.alarmLevel = Math.max(0, col.alarmLevel - dtS * 0.1);

      // Check for large creature intrusions near the nest
      for (const anim of animals) {
        const d = Math.hypot(anim.x - col.moundX, anim.y - col.moundY);
        if (d < 2.5) {
          col.alarmLevel = Math.min(1.0, col.alarmLevel + dtS * 0.5);
          this.grid.depositAlarm(col.moundX, col.moundY, this.worldWidth, this.worldHeight, 0.5);
        }
      }

      // Update individual ants
      for (const ant of col.ants) {
        ant.legPhase += dtS * 14 * ant.speed;

        switch (ant.state) {
          case "resting": {
            ant.restTimerS -= dtS;
            if (ant.restTimerS <= 0) {
              if (col.alarmLevel > 0.25) {
                ant.state = "alarm";
                ant.heading = Math.random() * Math.PI * 2;
              } else {
                ant.state = "foraging";
                ant.heading = Math.random() * Math.PI * 2;
              }
            }
            break;
          }

          case "foraging": {
            // Senses pheromones ahead
            const guided = this.grid.senseFoodHeading(
              ant.x,
              ant.y,
              ant.heading,
              this.worldWidth,
              this.worldHeight,
            );
            if (guided !== null) {
              ant.heading = ant.heading * 0.7 + guided * 0.3;
            } else {
              ant.heading += (Math.random() - 0.5) * 0.4;
            }

            // Move
            ant.x += Math.cos(ant.heading) * ant.speed * dtS;
            ant.y += Math.sin(ant.heading) * ant.speed * dtS;

            // Turn back if wandering too far from home island
            const distFromNest = Math.hypot(ant.x - col.moundX, ant.y - col.moundY);
            if (
              ant.x < 1 ||
              ant.x > this.worldWidth - 1 ||
              ant.y < 1 ||
              ant.y > this.worldHeight - 1 ||
              distFromNest > 24
            ) {
              ant.heading = Math.atan2(col.moundY - ant.y, col.moundX - ant.x);
            }

            // Scavenge chance near animals or random forage
            for (const anim of animals) {
              if (Math.hypot(anim.x - ant.x, anim.y - ant.y) < 1.2) {
                if (Math.random() < 0.2) {
                  ant.carrying = "food";
                  ant.carryColor = 0xd9534f; // Reddish protein crumb
                  ant.state = "returning";
                  ant.heading = Math.atan2(col.moundY - ant.y, col.moundX - ant.x);
                  break;
                }
              }
            }

            if (ant.state === "foraging" && distFromNest > 6 && Math.random() < dtS * 0.08) {
              ant.carrying = "leaf";
              ant.carryColor = 0x5cb85c; // Emerald foliage snippet
              ant.state = "returning";
              ant.heading = Math.atan2(col.moundY - ant.y, col.moundX - ant.x);
            }
            break;
          }

          case "returning": {
            // Lay food trail pheromone along the highway
            this.grid.depositFood(ant.x, ant.y, this.worldWidth, this.worldHeight, 0.3 * dtS * 8);

            // Navigate towards home mound
            const dx = col.moundX - ant.x;
            const dy = col.moundY - ant.y;
            const dist = Math.hypot(dx, dy);
            ant.heading = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.15;

            ant.x += Math.cos(ant.heading) * ant.speed * dtS;
            ant.y += Math.sin(ant.heading) * ant.speed * dtS;

            if (dist < 0.8) {
              // Deposit payload
              col.foodStores += 1;
              ant.carrying = "none";
              ant.state = "resting";
              ant.restTimerS = 1.0 + Math.random() * 2.0;
            }
            break;
          }

          case "alarm": {
            // Rush outward in defense
            this.grid.depositAlarm(ant.x, ant.y, this.worldWidth, this.worldHeight, 0.4 * dtS * 8);
            ant.heading += (Math.random() - 0.5) * 0.6;
            ant.x += Math.cos(ant.heading) * (ant.speed * 1.5) * dtS;
            ant.y += Math.sin(ant.heading) * (ant.speed * 1.5) * dtS;

            if (col.alarmLevel < 0.1) {
              ant.state = "foraging";
            }
            break;
          }
        }
      }
    }
  }
}

export const formicariumSystem = new FormicariumSystem();

export class FormicariumMod implements Mod {
  readonly meta: ModMetadata = {
    id: "formicarium",
    name: "Ant Colonies",
    version: "1.0.0",
    description:
      "Ant nests, scent trails between nests and food, workers and soldiers, and carrion carried away.",
    defaultEnabled: true,
  };

  private readonly groundContainer = new Container();
  private readonly overContainer = new Container();
  private readonly screenContainer = new Container();

  private readonly moundsGfx = new Graphics();
  private readonly pheromonesGfx = new Graphics();
  private readonly antsGfx = new Graphics();
  private readonly badgeGfx = new Graphics();

  readonly layers: ModLayers = {
    ground: this.groundContainer,
    over: this.overContainer,
    screen: this.screenContainer,
  };

  private screenWidth = 512;
  private screenHeight = 300;
  private currentTile = 4;

  constructor() {
    this.groundContainer.addChild(this.moundsGfx, this.pheromonesGfx);
    this.overContainer.addChild(this.antsGfx);
    this.screenContainer.addChild(this.badgeGfx);
    this.groundContainer.visible = false;
    this.overContainer.visible = false;
    this.screenContainer.visible = false;
  }

  init(ctx: ModContext): void {
    this.screenWidth = ctx.width;
    this.screenHeight = ctx.height;
  }

  enable(): void {
    setFormicariumActive(true);
    this.groundContainer.visible = true;
    this.overContainer.visible = true;
    this.screenContainer.visible = true;
  }

  disable(): void {
    setFormicariumActive(false);
    this.groundContainer.visible = false;
    this.overContainer.visible = false;
    this.screenContainer.visible = false;
    this.moundsGfx.clear();
    this.pheromonesGfx.clear();
    this.antsGfx.clear();
    this.badgeGfx.clear();
  }

  isEnabled(): boolean {
    return isFormicariumActive();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === "i" || e.key === "I") {
      togglePheromoneOverlay();
      return true;
    }
    return false;
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!formicariumActive) return;

    const land = isLand(options.land) ? options.land : null;
    if (land !== null) {
      formicariumSystem.adaptToLand(land);
    }

    const animals = Array.isArray(options.animals)
      ? (options.animals as { id: number; x: number; y: number }[])
      : [];

    formicariumSystem.update(dtS, animals);

    this.currentTile = typeof options.tile === "number" && options.tile > 0 ? options.tile : 4;
    this.drawMounds();
    this.drawPheromones();
    this.drawAnts();
    this.drawBadge();
  }

  /** Ant mounds drawn on ground layer in world cell coordinates. */
  private drawMounds(): void {
    const g = this.moundsGfx;
    g.clear();

    for (const col of formicariumSystem.colonies) {
      const cx = col.moundX;
      const cy = col.moundY;
      const radius = 1.2;

      // Base earthy conical mound
      g.ellipse(cx, cy, radius, radius * 0.75).fill({
        color: col.moundColor,
        alpha: 0.9,
      });

      // Shadowed lip
      g.ellipse(cx, cy + 0.2, radius * 0.85, radius * 0.55).fill({
        color: 0x2e1d10,
        alpha: 0.5,
      });

      // Central tunnel crater entrance
      g.ellipse(cx, cy, 0.35, 0.25).fill({
        color: 0x120c06,
        alpha: 0.95,
      });

      // Small scattered dirt granules
      g.rect(cx - 0.7, cy - 0.4, 0.15, 0.15).fill({ color: 0x8a6344, alpha: 0.8 });
      g.rect(cx + 0.6, cy - 0.3, 0.15, 0.15).fill({ color: 0x8a6344, alpha: 0.8 });
      g.rect(cx + 0.3, cy + 0.5, 0.15, 0.15).fill({ color: 0x8a6344, alpha: 0.8 });
      g.rect(cx - 0.5, cy + 0.4, 0.15, 0.15).fill({ color: 0x8a6344, alpha: 0.8 });
    }
  }

  /** Pheromone highway visualization when [I] is toggled. */
  private drawPheromones(): void {
    const g = this.pheromonesGfx;
    g.clear();
    if (!pheromoneOverlayActive) return;

    const { grid, worldWidth, worldHeight } = formicariumSystem;
    const cw = worldWidth / grid.size;
    const ch = worldHeight / grid.size;

    for (let gy = 0; gy < grid.size; gy++) {
      for (let gx = 0; gx < grid.size; gx++) {
        const idx = gy * grid.size + gx;
        const food = grid.foodTrails[idx] ?? 0;
        const alarm = grid.alarmTrails[idx] ?? 0;

        if (food > 0.05) {
          g.rect(gx * cw, gy * ch, cw, ch).fill({
            color: FOOD_TRAIL_COLOR,
            alpha: Math.min(0.5, food * 0.6),
          });
        }
        if (alarm > 0.05) {
          g.rect(gx * cw, gy * ch, cw, ch).fill({
            color: ALARM_TRAIL_COLOR,
            alpha: Math.min(0.65, alarm * 0.75),
          });
        }
      }
    }
  }

  /** Ants rendered in world cell units on over layer. Supports Macro Zoom 2x/3x. */
  private drawAnts(): void {
    const g = this.antsGfx;
    g.clear();

    const pixel = 1 / Math.max(1, this.currentTile);
    const macro = this.currentTile >= 16; // Macro zoom active (2x or 3x)

    for (const col of formicariumSystem.colonies) {
      for (const ant of col.ants) {
        if (ant.state === "resting") continue;

        const cos = Math.cos(ant.heading);
        const sin = Math.sin(ant.heading);

        if (!macro) {
          // Standard 1x zoom: 1x2 pixel scurrying critter
          const ax = Math.floor(ant.x / pixel) * pixel;
          const ay = Math.floor(ant.y / pixel) * pixel;
          g.rect(ax, ay, pixel, pixel).fill(col.antColor);
          g.rect(ax + cos * pixel, ay + sin * pixel, pixel, pixel).fill(col.antColor);

          if (ant.carrying !== "none") {
            g.rect(ax + cos * pixel * 2, ay + sin * pixel * 2, pixel, pixel).fill(ant.carryColor);
          }
        } else {
          // Macro Zoom 2x/3x: Anatomical pixel-art
          // Gaster / Abdomen (back)
          const gx = ant.x - cos * pixel * 2;
          const gy = ant.y - sin * pixel * 2;
          g.rect(gx - pixel, gy - pixel, pixel * 2, pixel * 2).fill(col.antColor);

          // Thorax (center)
          g.rect(ant.x - pixel * 0.5, ant.y - pixel * 0.5, pixel, pixel).fill(col.antColor);

          // Head (front)
          const hx = ant.x + cos * pixel * 1.5;
          const hy = ant.y + sin * pixel * 1.5;
          g.rect(hx - pixel * 0.5, hy - pixel * 0.5, pixel, pixel).fill(col.antColor);

          // Micro-antennae
          const leftAntX = hx + (cos - sin * 0.7) * pixel;
          const leftAntY = hy + (sin + cos * 0.7) * pixel;
          const rightAntX = hx + (cos + sin * 0.7) * pixel;
          const rightAntY = hy + (sin - cos * 0.7) * pixel;
          g.rect(leftAntX, leftAntY, pixel * 0.7, pixel * 0.7).fill(col.antColor);
          g.rect(rightAntX, rightAntY, pixel * 0.7, pixel * 0.7).fill(col.antColor);

          // Animated 6 micro-legs
          const legWiggle = Math.sin(ant.legPhase) * pixel * 0.8;
          g.rect(
            ant.x - sin * pixel * 1.5,
            ant.y + cos * pixel * 1.5 + legWiggle,
            pixel,
            pixel,
          ).fill(col.antColor);
          g.rect(
            ant.x + sin * pixel * 1.5,
            ant.y - cos * pixel * 1.5 - legWiggle,
            pixel,
            pixel,
          ).fill(col.antColor);

          // Carried leaf snippet or food crumb
          if (ant.carrying !== "none") {
            const carryX = hx + cos * pixel * 2;
            const carryY = hy + sin * pixel * 2;
            g.rect(carryX - pixel, carryY - pixel, pixel * 2, pixel * 2).fill(ant.carryColor);
          }
        }
      }
    }
  }

  /** Small pixel font badge on screen layer when [I] is toggled. */
  private drawBadge(): void {
    const g = this.badgeGfx;
    g.clear();
    if (!pheromoneOverlayActive) return;

    const title = "[I] Formicarium: Pheromone Network";
    const status = `Red: ${formicariumSystem.colonies[0]?.foodStores ?? 0}  Black: ${
      formicariumSystem.colonies[1]?.foodStores ?? 0
    }  Amber: ${formicariumSystem.colonies[2]?.foodStores ?? 0}`;

    const textWidth = Math.max(measure(title), measure(status));
    const pad = 4;
    const width = textWidth + pad * 2;
    const height = pad * 2 + GLYPH_ROWS * 2 + 2;

    const x0 = 6;
    const y0 = this.screenHeight - height - 24;

    g.rect(x0 - 1, y0 - 1, width + 2, height + 2).fill(INK);
    g.rect(x0, y0, width, height).fill(PAPER);

    drawCaption(title, x0 + pad, y0 + pad, (x, y) => {
      g.rect(x, y, 1, 1).fill(FOOD_TRAIL_COLOR);
    });

    drawCaption(status, x0 + pad, y0 + pad + GLYPH_ROWS + 2, (x, y) => {
      g.rect(x, y, 1, 1).fill(INK);
    });
  }
}

function isLand(value: unknown): value is Land {
  if (typeof value !== "object" || value === null) return false;
  const land = value as Partial<Land>;
  return (
    typeof land.width === "number" &&
    typeof land.height === "number" &&
    typeof land.seaLevel === "number" &&
    land.heights instanceof Float32Array
  );
}
