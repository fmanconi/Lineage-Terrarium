/**
 * The third mod (ADR 0024): Winter Yule & Christmas Isle. On, snow falls on the whole
 * island whatever the season or the weather (`atmosphere/atmosphere.ts`), every animal
 * wears a small Santa hat (`creatures/layer.ts`), lights twinkle on the trees and bushes
 * and a winter star shines in the sky at dusk and at night. Drawing only: the sim, its
 * weather and its seasons are untouched.
 */
import type { Mod, ModMetadata } from "../types";

let christmasActive = false;

/** Switch the festive drawing on or off (the mod does; tests may). */
export function setChristmasActive(active: boolean): void {
  christmasActive = active;
}

/** Whether the island is drawn for the holidays. */
export function isChristmasActive(): boolean {
  return christmasActive;
}

export class ChristmasMod implements Mod {
  readonly meta: ModMetadata = {
    id: "christmas-yule",
    name: "Winter Yule & Christmas Isle",
    version: "1.0.0",
    description:
      "Holiday celebration: gentle snowfall, Santa hats on creatures, twinkling tree lights, and a glowing winter star.",
    defaultEnabled: true,
  };

  init(): void {
    // Nothing of its own to draw: the atmosphere and the creatures read the flag.
  }

  enable(): void {
    setChristmasActive(true);
  }

  disable(): void {
    setChristmasActive(false);
  }

  isEnabled(): boolean {
    return isChristmasActive();
  }
}
