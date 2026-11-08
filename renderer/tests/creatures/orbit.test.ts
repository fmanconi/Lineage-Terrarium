import { describe, expect, it } from "vitest";
import { drive, newMotion, reanchor, type Walker } from "../../src/creatures/motion";

/**
 * Walking to a near place off to its side, an animal reaches it instead of circling it
 * (08/11/2026: at a fast pace the circle of its turning was wider than the way there, and
 * many animals went round and round their place from the sim).
 */
function approach(pace: number, distance: number): { arrived: boolean; turns: number } {
  const walker: Walker = { head: { x: 0, y: 0 }, heading: 0, pace, length: 1, turning: 0.15 };
  const motion = newMotion({ x: 0, y: 0 }, 0);
  const side = (100 * Math.PI) / 180;
  const x = distance * Math.cos(side);
  const y = distance * Math.sin(side);
  reanchor(motion, walker, x, y);
  motion.mode = "travel";
  motion.goal.x = x;
  motion.goal.y = y;
  let seed = 0.5;
  const random = (): number => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
  let turned = 0;
  let last = walker.heading;
  for (let t = 0; t < 10 && motion.mode === "travel"; t += 1 / 30) {
    drive(motion, walker, 1 / 30, random, () => true);
    turned += Math.abs(walker.heading - last);
    last = walker.heading;
  }
  return { arrived: motion.mode !== "travel", turns: turned / (2 * Math.PI) };
}

describe("walking to a near place", () => {
  for (const pace of [0.5, 1, 2, 3, 4.4]) {
    for (const distance of [0.3, 0.6, 1, 1.5]) {
      it(`reaches a place ${distance} cells to its side at ${pace} cells a second`, () => {
        const { arrived, turns } = approach(pace, distance);
        expect(arrived).toBe(true);
        // About the 100° it takes to face the place, not laps round it.
        expect(turns).toBeLessThan(0.6);
      });
    }
  }
});
