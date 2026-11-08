/**
 * The fourth mod (ADR 0024): Packs and Rivals. On, animals of one
 * species near each other stroll as a pack, a pack of four or more keeps a nest at its
 * middle (drawn on the ground), and animals of two species meeting face off: sparks fly
 * and the side with fewer allies near backs away (`creatures/pack.ts`, driven by
 * `creatures/layer.ts`). Drawing only: where the sim has each animal is untouched.
 */
import type { Mod, ModMetadata } from "../types";

let packWarfareActive = false;

/** Switch the packs, nests and face-offs on or off (the mod does; tests may). */
export function setPackWarfareActive(active: boolean): void {
  packWarfareActive = active;
}

/** Whether animals go about in packs. */
export function isPackWarfareActive(): boolean {
  return packWarfareActive;
}

export class PackWarfareMod implements Mod {
  readonly meta: ModMetadata = {
    id: "pack-warfare",
    name: "Packs and Rivals",
    version: "1.0.0",
    description:
      "Animals of a species move together, larger groups keep a nest, and rival species face off.",
    defaultEnabled: true,
  };

  init(): void {
    // Nothing to set up: the creature layer reads the switch each frame.
  }

  enable(): void {
    setPackWarfareActive(true);
  }

  disable(): void {
    setPackWarfareActive(false);
  }

  isEnabled(): boolean {
    return isPackWarfareActive();
  }
}
