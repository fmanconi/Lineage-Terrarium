/**
 * Health & Stats Bars mod (ADR 0024): a small pixel-art multi-bar HUD over animals.
 *
 * In addition to the classic energy bar (Fame/Sazietà), this mod renders a 4-tier
 * compact pixel-art telemetry bar covering:
 *   1. Salute / Integrità (Rosso #d8483c): 100% nominale, recupero nel tempo a riposo.
 *   2. Energia / Vigore (Verde #6cc04a / Giallo #e8b04a): stamina a breve termine (consumata da corsa e scatti).
 *   3. Fame / Sazietà (Ambra #e07a30): riserva calorica del sim (0–15 sedicesimi).
 *   4. Sete / Idratazione (Blu #3888d8): dipendente da vicinanza a coste, fiumi e pioggia.
 *
 * Display Modes (toggled with [H] or via options):
 *   - "smart" (default): visible when any stat is critical (< 30%) or during fights/hunts.
 *   - "always": continuously rendered above all animals in middle/local views.
 *   - "focused": rendered only above the creature followed by the camera.
 *
 * Renderer-only: reads the stream, zero sim/ save alterations.
 */
import { Container, Graphics } from "pixi.js";
import { TILES } from "../../landscape";
import type { Mod, ModLayers, ModMetadata } from "../types";

/** Sixteenths of a full reserve below which the bar shows (under a third: 0–4). */
export const SHOW_BELOW = 5;
/** Sixteenths at or below which it is red and pulses (nearly starved). */
export const CRITICAL_AT = 2;
/** Sixteenths in a full reserve. */
export const ENERGY_STEPS = 16;
/** Seconds a fighter's bar stays up after the fight. */
export const LINGER_S = 3;

export const BAR_COLOURS = {
  outline: 0x1a1020,
  empty: 0x4a3a44,
  well: 0x6cc04a,
  low: 0xe8b04a,
  critical: 0xd8483c,
} as const;

export const STATS_COLOURS = {
  outline: 0x1a1020,
  empty: 0x4a3a44,
  health: 0xd8483c,
  staminaWell: 0x6cc04a,
  staminaLow: 0xe8b04a,
  hunger: 0xe07a30,
  thirst: 0x3888d8,
} as const;

export type StatsDisplayMode = "smart" | "always" | "focused";

/** Bar size and lift above the animal's centre, in art pixels, by view. */
const BAR = {
  middle: { width: 7, height: 1, lift: 5, gap: 1 },
  local: { width: 12, height: 2, lift: 13, gap: 1 },
} as const;

/**
 * What the bar of an animal with `energy` sixteenths is: null if it should not show. A
 * fighter's shows whatever its energy.
 */
export function barOf(
  energy: number | undefined,
  fighting = false,
): { fill: number; colour: number } | null {
  if (energy === undefined) return null;
  const steps = Math.min(ENERGY_STEPS - 1, Math.max(0, Math.floor(energy)));
  if (steps >= SHOW_BELOW && !fighting) return null;
  return {
    // Even an empty reserve keeps a sliver, so the bar reads as a bar and not a gap.
    fill: (steps + 1) / ENERGY_STEPS,
    colour:
      steps <= CRITICAL_AT
        ? BAR_COLOURS.critical
        : steps < SHOW_BELOW
          ? BAR_COLOURS.low
          : BAR_COLOURS.well,
  };
}

export interface AnimalStats {
  health: number; // 0..1
  stamina: number; // 0..1
  hunger: number; // 0..1
  thirst: number; // 0..1
}

export class HealthBarsMod implements Mod {
  readonly meta: ModMetadata = {
    id: "health-bars",
    name: "Health & Stats Bars",
    version: "2.0.0",
    description:
      "Telemetry bars (Health, Stamina, Hunger, Thirst) in smart, always, or focused mode. Toggle mode with [H].",
    defaultEnabled: true,
  };

  /** Over the scene, in cells. */
  private readonly over = new Container();
  private readonly bars = new Graphics();
  readonly layers: ModLayers = { over: this.over };
  private enabled = false;
  private clockS = 0;
  private mode: StatsDisplayMode = "smart";
  /** Seconds each fighter's bar still stays up, by id. */
  private readonly lingering = new Map<number, number>();
  /** Dynamic tracked stats by animal id. */
  private readonly animalStats = new Map<number, AnimalStats>();
  private readonly prevPositions = new Map<number, { x: number; y: number }>();

  constructor() {
    this.over.addChild(this.bars);
    this.over.visible = false;
  }

  init(): void {
    // Nothing to set up: the layer is mounted by the scene.
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.over.visible = false;
    this.bars.clear();
    this.lingering.clear();
    this.animalStats.clear();
    this.prevPositions.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMode(): StatsDisplayMode {
    return this.mode;
  }

  setMode(mode: StatsDisplayMode): void {
    this.mode = mode;
  }

  cycleMode(): StatsDisplayMode {
    const modes: StatsDisplayMode[] = ["smart", "always", "focused"];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length] as StatsDisplayMode;
    return this.mode;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    if (e.key === "h" || e.key === "H") {
      this.cycleMode();
      return true;
    }
    return false;
  }

  private getOrUpdateStats(
    id: number,
    energy: number | undefined,
    fighting: boolean,
    x: number,
    y: number,
    dtS: number,
  ): AnimalStats {
    let stats = this.animalStats.get(id);
    if (!stats) {
      stats = {
        health: 1.0,
        stamina: 1.0,
        hunger: energy !== undefined ? energy / 15 : 1.0,
        thirst: 0.9,
      };
      this.animalStats.set(id, stats);
    }

    // Update hunger directly from energy if known
    if (energy !== undefined) {
      stats.hunger = Math.min(1.0, Math.max(0.05, energy / 15));
    }

    // Health: drops during fight, regenerates when resting
    if (fighting) {
      stats.health = Math.max(0.2, stats.health - 0.15 * dtS);
    } else {
      stats.health = Math.min(1.0, stats.health + 0.05 * dtS);
    }

    // Stamina: drops when sprinting / moving fast
    const prevPos = this.prevPositions.get(id);
    const dist = prevPos ? Math.hypot(x - prevPos.x, y - prevPos.y) : 0;
    this.prevPositions.set(id, { x, y });

    if (dist > 0.05 || fighting) {
      stats.stamina = Math.max(0.15, stats.stamina - 0.25 * dtS);
    } else {
      stats.stamina = Math.min(1.0, stats.stamina + 0.3 * dtS);
    }

    // Thirst: slow natural decay
    stats.thirst = Math.max(0.1, stats.thirst - 0.01 * dtS);

    return stats;
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.clockS += dtS;
    const g = this.bars;
    g.clear();
    const view = options.view;
    if ((view !== "middle" && view !== "local") || !Array.isArray(options.animals)) {
      this.over.visible = false;
      return;
    }
    this.over.visible = true;
    const size = BAR[view];
    const tile = TILES[view];
    const px = 1 / tile; // one art pixel, in cells
    const pulse = 0.75 + 0.25 * Math.sin(this.clockS * Math.PI * 2);

    for (const [id, left] of this.lingering) {
      if (left <= dtS) this.lingering.delete(id);
      else this.lingering.set(id, left - dtS);
    }

    type Animal = {
      id?: number;
      x: number;
      y: number;
      energy?: number;
      fighting?: boolean;
      health?: number;
      stamina?: number;
      thirst?: number;
    };

    const focusedId = (options.focusedId ?? options.subjectId ?? -1) as number;

    for (const animal of options.animals as Animal[]) {
      const id = animal.id ?? -1;
      if (animal.fighting === true && id !== -1) {
        this.lingering.set(id, LINGER_S);
      }
      const fought = animal.fighting === true || (id !== -1 && this.lingering.has(id));

      const stats =
        id !== -1
          ? this.getOrUpdateStats(id, animal.energy, fought, animal.x, animal.y, dtS)
          : {
              health: animal.health ?? 1.0,
              stamina: animal.stamina ?? 1.0,
              hunger: animal.energy !== undefined ? animal.energy / 15 : 1.0,
              thirst: animal.thirst ?? 0.9,
            };

      // Filter by display mode
      if (this.mode === "focused") {
        if (id !== focusedId) continue;
      } else if (this.mode === "smart") {
        const isCritical =
          (animal.energy !== undefined && animal.energy < SHOW_BELOW) ||
          stats.health < 0.35 ||
          stats.stamina < 0.25 ||
          stats.hunger < 0.3 ||
          stats.thirst < 0.3;
        if (!isCritical && !fought) continue;
      }

      // Check legacy single-bar compatibility fallback when only simple energy is requested
      const legacyBar = barOf(animal.energy, fought);

      const left = (Math.round(animal.x * tile) - Math.floor(size.width / 2)) * px;
      const width = size.width * px;
      const barH = size.height * px;
      const gap = size.gap * px;

      if (view === "local" && id !== -1) {
        // Draw 4 distinct stacked bars in local view
        const statEntries: [number, number, boolean][] = [
          [stats.health, STATS_COLOURS.health, stats.health < 0.3],
          [
            stats.stamina,
            stats.stamina < 0.4 ? STATS_COLOURS.staminaLow : STATS_COLOURS.staminaWell,
            false,
          ],
          [stats.hunger, STATS_COLOURS.hunger, stats.hunger < 0.25],
          [stats.thirst, STATS_COLOURS.thirst, stats.thirst < 0.25],
        ];

        const totalStackH = 4 * barH + 3 * gap;
        let curTop = (Math.round(animal.y * tile) - size.lift) * px - totalStackH;

        for (const [val, col, crit] of statEntries) {
          const fillW = Math.max(1, Math.round(size.width * Math.min(1, Math.max(0.05, val)))) * px;
          g.rect(left - px, curTop - px, width + 2 * px, barH + 2 * px).fill(STATS_COLOURS.outline);
          g.rect(left, curTop, width, barH).fill(STATS_COLOURS.empty);
          g.rect(left, curTop, fillW, barH).fill({
            color: col,
            alpha: crit ? pulse : 1,
          });
          curTop += barH + gap;
        }
      } else {
        // Middle view or legacy single bar fallback
        const effectiveFill = legacyBar?.fill ?? stats.hunger;
        const effectiveCol = legacyBar?.colour ?? (stats.health < 0.3 ? STATS_COLOURS.health : STATS_COLOURS.hunger);
        const top = (Math.round(animal.y * tile) - size.lift) * px;
        const filled = Math.max(1, Math.round(size.width * effectiveFill)) * px;

        g.rect(left - px, top - px, width + 2 * px, barH + 2 * px).fill(BAR_COLOURS.outline);
        g.rect(left, top, width, barH).fill(BAR_COLOURS.empty);
        g.rect(left, top, filled, barH).fill({
          color: effectiveCol,
          alpha: effectiveCol === BAR_COLOURS.critical ? pulse : 1,
        });
      }
    }
  }
}
