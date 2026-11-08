import { afterEach, describe, expect, it } from "vitest";

import {
  chooseStroll,
  drive,
  isPurposefulWanderer,
  leash,
  newMotion,
  setPurposefulWanderer,
  type Walker,
} from "../../src/creatures/motion";
import { PurposefulWandererMod } from "../../src/mods/builtin/wanderer";
import { MODS_STORAGE_KEY, ModRegistry, memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";

const CTX = {
  frame: {} as HTMLElement,
  width: 512,
  height: 300,
  storage: memoryStorage(),
} satisfies ModContext;

/** A seeded stream (mulberry32), so that every test draws the same numbers. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far `angle` is from `heading`, either way round, in radians. */
const off = (angle: number, heading: number): number =>
  Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)));

const open = (): boolean => true;

afterEach(() => {
  setPurposefulWanderer(false);
});

describe("PurposefulWandererMod", () => {
  it("declares itself on by default", () => {
    const mod = new PurposefulWandererMod();
    expect(mod.meta.id).toBe("purposeful-wanderer");
    expect(mod.meta.name).toBe("Purposeful Wanderer AI");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("switches the wanderer in motion.ts on and off", () => {
    const mod = new PurposefulWandererMod();
    mod.enable();
    expect(isPurposefulWanderer()).toBe(true);
    expect(mod.isEnabled()).toBe(true);
    mod.disable();
    expect(isPurposefulWanderer()).toBe(false);
    expect(mod.isEnabled()).toBe(false);
  });

  it("is on when the registry starts it, and its toggle is kept", () => {
    const storage = memoryStorage();
    const registry = new ModRegistry(storage);
    registry.register(new PurposefulWandererMod());
    registry.initAll(CTX);
    expect(isPurposefulWanderer()).toBe(true);
    expect(registry.toggleMod("purposeful-wanderer")).toBe(false);
    expect(isPurposefulWanderer()).toBe(false);
    expect(JSON.parse(storage.getItem(MODS_STORAGE_KEY) ?? "{}")).toEqual({
      "purposeful-wanderer": false,
    });

    // A reload with the stored state: it starts off.
    setPurposefulWanderer(true);
    const again = new ModRegistry(storage);
    again.register(new PurposefulWandererMod());
    again.initAll(CTX);
    expect(isPurposefulWanderer()).toBe(false);
  });
});

describe("chooseStroll with the wanderer", () => {
  const reach = leash(1);

  it("goes on ahead, within the cone about the heading", () => {
    setPurposefulWanderer(true);
    const random = seeded(7);
    for (let k = 0; k < 200; k++) {
      const heading = (k / 200) * 2 * Math.PI;
      const motion = newMotion({ x: 10, y: 10 }, heading);
      const head = { x: 10, y: 10 };
      expect(chooseStroll(motion, head, heading, reach, random, open)).toBe(true);
      const { goal } = motion;
      const angle = Math.atan2(goal.y - head.y, goal.x - head.x);
      expect(off(angle, heading)).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
      expect(Math.hypot(goal.x - 10, goal.y - 10)).toBeLessThanOrEqual(reach + 1e-9);
    }
  });

  it("goes anywhere round the anchor without it", () => {
    const random = seeded(7);
    let behind = 0;
    for (let k = 0; k < 200; k++) {
      const motion = newMotion({ x: 10, y: 10 }, 0);
      expect(chooseStroll(motion, { x: 10, y: 10 }, 0, reach, random, open)).toBe(true);
      const angle = Math.atan2(motion.goal.y - 10, motion.goal.x - 10);
      if (off(angle, 0) > Math.PI / 2) behind++;
    }
    // About half the strolls go back the way it faced.
    expect(behind).toBeGreaterThan(60);
  });

  it("widens the cone when the way ahead is blocked", () => {
    setPurposefulWanderer(true);
    // A wall ahead (x > 10): it must turn aside or back.
    const blocked = (x: number): boolean => x <= 10;
    const motion = newMotion({ x: 10, y: 10 }, 0);
    const head = { x: 10, y: 10 };
    expect(chooseStroll(motion, head, 0, reach, seeded(3), blocked)).toBe(true);
    expect(motion.goal.x).toBeLessThanOrEqual(10);
  });

  it("turns back near the end of its leash, never past it", () => {
    setPurposefulWanderer(true);
    const random = seeded(11);
    for (let k = 0; k < 50; k++) {
      const motion = newMotion({ x: 10, y: 10 }, 0);
      // At the leash's end, facing out.
      const head = { x: 10 + 0.95 * reach, y: 10 };
      if (!chooseStroll(motion, head, 0, reach, random, open)) continue;
      expect(motion.goal.x).toBeLessThan(head.x);
      expect(Math.hypot(motion.goal.x - 10, motion.goal.y - 10)).toBeLessThanOrEqual(reach + 1e-9);
    }
  });
});

describe("pausing with the wanderer", () => {
  it("looks about only a little either side of where it faced", () => {
    setPurposefulWanderer(true);
    const random = seeded(5);
    const motion = newMotion({ x: 10, y: 10 }, 1);
    motion.timer = 1e9; // a pause that does not end
    const walker: Walker = { head: { x: 10, y: 10 }, heading: 1, pace: 1, length: 1 };
    let most = 0;
    for (let k = 0; k < 3000; k++) {
      drive(motion, walker, 1 / 30, random, open);
      most = Math.max(most, off(walker.heading, 1));
    }
    expect(motion.mode).toBe("pause");
    expect(most).toBeLessThanOrEqual(Math.PI / 12 + 1e-9);
    expect(most).toBeGreaterThan(0);
  });
});
