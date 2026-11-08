/**
 * The second mod (ADR 0024): Steady Walking. Animals strolling about their anchor
 * pick a new direction anywhere round it, so they turn on the spot over and over; on,
 * they stroll on ahead within a cone about their heading (`creatures/motion.ts`), turning
 * back only near the end of their leash, and look about only a little while they pause.
 * Drawing only: what the sim says of where they are is untouched.
 */
import { isPurposefulWanderer, setPurposefulWanderer } from "../../creatures/motion";
import type { Mod, ModMetadata } from "../types";

export class PurposefulWandererMod implements Mod {
  readonly meta: ModMetadata = {
    id: "purposeful-wanderer",
    name: "Steady Walking",
    version: "1.0.0",
    description: "Animals walk on ahead instead of turning on the spot.",
    defaultEnabled: true,
  };

  init(): void {
    // Nothing to draw: the mod only switches how animals stroll.
  }

  enable(): void {
    setPurposefulWanderer(true);
  }

  disable(): void {
    setPurposefulWanderer(false);
  }

  isEnabled(): boolean {
    return isPurposefulWanderer();
  }
}
