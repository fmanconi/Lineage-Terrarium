/**
 * Health Bars mod (ADR 0024): a small pixel-art bar over each animal that is running out
 * of energy, so the hungry stand out at a glance and the scene stays clean otherwise.
 *
 * The bar is the animal's real energy over its body's capacity, as the server sends it
 * (`energy` in the creatures message, in sixteenths), on one scale for all: full is a full
 * reserve. It shows below a third of a reserve, and on every animal in a fight (a face-off
 * between packs, backing away from one, a hunt) whatever its energy, for the fight and
 * `LINGER_S` after: green when well, amber when low, red and pulsing when nearly starved.
 * Drawn over the scene in the middle and local views; on the map the animals are dots.
 *
 * A face-off is the Pack Warfare mod's drawing: it costs no energy in the sim, so the bars
 * of two rivals show how well fed each is, not wounds.
 *
 * Renderer-only: it reads the stream, and nothing of `sim/` or the saves changes.
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

/** Bar size and lift above the animal's centre, in art pixels, by view. */
const BAR = {
  middle: { width: 7, height: 1, lift: 5 },
  local: { width: 12, height: 2, lift: 13 },
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

export class HealthBarsMod implements Mod {
  readonly meta: ModMetadata = {
    id: "health-bars",
    name: "Health Bars",
    version: "1.0.0",
    description:
      "An energy bar over animals low on energy, and over animals in a fight or a hunt: green, amber, then red.",
    defaultEnabled: true,
  };

  /** Over the scene, in cells. */
  private readonly over = new Container();
  private readonly bars = new Graphics();
  readonly layers: ModLayers = { over: this.over };
  private enabled = false;
  private clockS = 0;
  /** Seconds each fighter's bar still stays up, by id. */
  private readonly lingering = new Map<number, number>();

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
  }

  isEnabled(): boolean {
    return this.enabled;
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
    // The view's own art pixel (not the screen's): under Terrarium XL's macro zoom the bar
    // grows with the animals it sits on.
    const tile = TILES[view];
    const px = 1 / tile; // one art pixel, in cells
    // The pulse of the nearly starved: between full and half strength, about once a second.
    const pulse = 0.75 + 0.25 * Math.sin(this.clockS * Math.PI * 2);
    for (const [id, left] of this.lingering) {
      if (left <= dtS) this.lingering.delete(id);
      else this.lingering.set(id, left - dtS);
    }
    type Animal = { id?: number; x: number; y: number; energy?: number; fighting?: boolean };
    for (const animal of options.animals as Animal[]) {
      if (animal.fighting === true && animal.id !== undefined) {
        this.lingering.set(animal.id, LINGER_S);
      }
      const fought =
        animal.fighting === true || (animal.id !== undefined && this.lingering.has(animal.id));
      const bar = barOf(animal.energy, fought);
      if (bar === null) continue;
      // Snapped to whole art pixels, so the bar stays crisp as the animal walks.
      const left = (Math.round(animal.x * tile) - Math.floor(size.width / 2)) * px;
      const top = (Math.round(animal.y * tile) - size.lift) * px;
      const width = size.width * px;
      const height = size.height * px;
      const filled = Math.max(1, Math.round(size.width * bar.fill)) * px;
      g.rect(left - px, top - px, width + 2 * px, height + 2 * px).fill(BAR_COLOURS.outline);
      g.rect(left, top, width, height).fill(BAR_COLOURS.empty);
      g.rect(left, top, filled, height).fill({
        color: bar.colour,
        alpha: bar.colour === BAR_COLOURS.critical ? pulse : 1,
      });
    }
  }
}
