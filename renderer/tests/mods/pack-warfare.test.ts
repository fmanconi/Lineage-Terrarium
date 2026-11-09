import { afterEach, describe, expect, it, vi } from "vitest";

import { leash, newMotion, type Motion } from "../../src/creatures/motion";
import {
  NEST_MEMBERS,
  RETREAT_CELLS,
  STARE_S,
  alliesNear,
  findPacks,
  groupBySpecies,
  meanHeading,
  newPackState,
  packAdvantage,
  updatePackDynamics,
  type PackMember,
} from "../../src/creatures/pack";
import {
  PackWarfareMod,
  isPackWarfareActive,
  setPackWarfareActive,
} from "../../src/mods/builtin/pack-warfare";
import { MODS_STORAGE_KEY, ModRegistry, memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";

const CTX = {
  frame: {} as HTMLElement,
  width: 512,
  height: 300,
  storage: memoryStorage(),
} satisfies ModContext;

type Animal = PackMember & { motion: Motion };

/** An animal one cell long, paused where the sim has it, its head at (x, y). */
function animal(species: number, x: number, y: number, heading = 0): Animal {
  return {
    species,
    young: false,
    nurturing: false,
    joints: [{ x, y }],
    heading,
    motion: newMotion({ x, y }, heading),
    plan: { length: 1 },
    pack: newPackState(),
  };
}

/** How far `angle` is from `heading`, either way round, in radians. */
const off = (angle: number, heading: number): number =>
  Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)));

const headOf = (a: Animal): { x: number; y: number } => a.joints[0] ?? { x: 0, y: 0 };

/** The way from its head to its stroll's goal. */
const goalWay = (a: Animal): number =>
  Math.atan2(a.motion.goal.y - headOf(a).y, a.motion.goal.x - headOf(a).x);

/** A stroll begun since the last pass, toward (x, y). */
function strollTo(a: Animal, x: number, y: number): void {
  a.motion.mode = "stroll";
  a.motion.goal.x = x;
  a.motion.goal.y = y;
}

const withinLeash = (a: Animal): boolean =>
  Math.hypot(a.motion.goal.x - a.motion.anchor.x, a.motion.goal.y - a.motion.anchor.y) <=
  leash(a.plan.length) + 1e-9;

afterEach(() => {
  setPackWarfareActive(false);
});

describe("PackWarfareMod", () => {
  it("declares itself on by default", () => {
    const mod = new PackWarfareMod();
    expect(mod.meta.id).toBe("pack-warfare");
    expect(mod.meta.name).toBe("Packs and Rivals");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.description).toBe(
      "Animals of a species move together, larger groups keep a nest, and rival species face off.",
    );
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("switches the packs on and off", () => {
    const mod = new PackWarfareMod();
    mod.enable();
    expect(isPackWarfareActive()).toBe(true);
    expect(mod.isEnabled()).toBe(true);
    mod.disable();
    expect(isPackWarfareActive()).toBe(false);
    expect(mod.isEnabled()).toBe(false);
  });

  it("is on when the registry starts it, and its toggle is kept", () => {
    const storage = memoryStorage();
    const registry = new ModRegistry(storage);
    registry.register(new PackWarfareMod());
    registry.initAll(CTX);
    expect(isPackWarfareActive()).toBe(true);
    expect(registry.toggleMod("pack-warfare")).toBe(false);
    expect(isPackWarfareActive()).toBe(false);
    expect(JSON.parse(storage.getItem(MODS_STORAGE_KEY) ?? "{}")).toEqual({
      "pack-warfare": false,
    });
  });
});

describe("grouping", () => {
  it("groups the animals by species, skipping empty slots", () => {
    const a = animal(3, 0, 0);
    const b = animal(5, 1, 0);
    const c = animal(3, 2, 0);
    const groups = groupBySpecies([a, undefined, b, c]);
    expect([...groups.keys()]).toEqual([3, 5]);
    expect(groups.get(3)).toEqual([a, c]);
    expect(groups.get(5)).toEqual([b]);
  });

  it("links a species into packs by heads within 3 cells", () => {
    // A chain 2.5 cells a link is one pack; an animal 10 cells off is its own.
    const chain = [animal(1, 0, 0), animal(1, 2.5, 0), animal(1, 5, 0)];
    const alone = animal(1, 15, 0);
    const packs = findPacks([...chain, alone]);
    expect(packs).toHaveLength(2);
    expect(packs[0]).toEqual(chain);
    expect(packs[1]).toEqual([alone]);
  });

  it("averages headings round the circle", () => {
    const a = animal(1, 0, 0, Math.PI - 0.1);
    const b = animal(1, 0, 0, -Math.PI + 0.1);
    expect(off(meanHeading([a, b]), Math.PI)).toBeLessThan(1e-9);
    expect(Number.isNaN(meanHeading([]))).toBe(true);
  });
});

describe("pack movement", () => {
  it("turns paused members toward one heading", () => {
    const pack = [
      animal(1, 10, 10, 0),
      animal(1, 11, 10, 0.9),
      animal(1, 10, 11, -0.8),
      animal(1, 11, 11, 1.6),
    ];
    const spread = (): number => {
      const mean = meanHeading(pack);
      return Math.max(...pack.map((a) => off(a.heading, mean)));
    };
    const before = spread();
    for (let pass = 0; pass < 20; pass++) {
      updatePackDynamics(pack, 0.2);
      // Their heads turn to where they look, as `drive` would turn them.
      for (const a of pack) a.heading = a.motion.facing;
    }
    expect(before).toBeGreaterThan(1);
    expect(spread()).toBeLessThan(0.05);
  });

  it("leans a new stroll the way the pack faces, within the leash", () => {
    // Three strong, so no nest pulls it.
    const mates = [animal(1, 11, 10, 0), animal(1, 11, 11, 0)];
    const walker = animal(1, 10, 10, Math.PI / 2);
    const pack = [walker, ...mates];
    updatePackDynamics(pack, 0.2);
    strollTo(walker, 10, 10.6);
    updatePackDynamics(pack, 0.2);
    expect(off(goalWay(walker), 0)).toBeLessThan(Math.PI / 2 - 0.3);
    expect(withinLeash(walker)).toBe(true);
    // Steered once: a stroll under way is left alone.
    const goal = { ...walker.motion.goal };
    updatePackDynamics(pack, 0.2);
    expect(walker.motion.goal).toEqual(goal);
  });

  it("steps away from a mate too close", () => {
    const a = animal(1, 10, 10);
    const b = animal(1, 10.2, 10);
    updatePackDynamics([a, b], 0.2);
    expect(a.motion.mode).toBe("stroll");
    expect(a.motion.goal.x).toBeLessThan(10);
    expect(withinLeash(a)).toBe(true);
  });

  it("sends a stray's next stroll back toward its mates", () => {
    const mates = [animal(1, 10, 10), animal(1, 10, 11.5), animal(1, 11, 10.5)];
    const stray = animal(1, 15.5, 10.5);
    const all = [...mates, stray];
    updatePackDynamics(all, 0.2);
    // It chose to stroll on, away from them.
    strollTo(stray, 16.2, 10.5);
    updatePackDynamics(all, 0.2);
    expect(stray.motion.goal.x).toBeLessThan(15.5);
    expect(withinLeash(stray)).toBe(true);
  });
});

describe("colonies", () => {
  it(`keeps a nest at the middle of a pack of ${NEST_MEMBERS} or more`, () => {
    const pack = [animal(2, 10, 10), animal(2, 12, 10), animal(2, 10, 12), animal(2, 12, 12)];
    const nests = updatePackDynamics(pack, 0.2);
    expect(nests).toEqual([{ species: 2, x: 11, y: 11, members: 4 }]);
    expect(updatePackDynamics(pack.slice(0, 3), 0.2)).toEqual([]);
  });

  it("draws the young toward the nest", () => {
    const pack = [animal(2, 10, 10), animal(2, 12, 10), animal(2, 10, 12), animal(2, 12, 12)];
    const young = pack[0] as Animal;
    young.young = true;
    updatePackDynamics(pack, 0.2);
    // It chose to stroll away from the nest at (11, 11).
    strollTo(young, 9.4, 10);
    updatePackDynamics(pack, 0.2);
    const toNest = Math.atan2(11 - 10, 11 - 10);
    expect(off(goalWay(young), toNest)).toBeLessThan(Math.PI / 2);
  });
});

describe("territorial warfare", () => {
  it("counts allies and gives the advantage to the larger pack", () => {
    const leader = animal(1, 10, 10);
    const allies = [animal(1, 9, 10), animal(1, 9, 11)];
    const rival = animal(2, 11.5, 10);
    const all = [leader, ...allies, rival];
    expect(alliesNear(leader, all)).toBe(2);
    expect(alliesNear(rival, all)).toBe(0);
    expect(packAdvantage(leader, rival, all)).toBe("a");
    expect(packAdvantage(rival, leader, all)).toBe("b");
    const stranger = animal(3, 11, 10);
    expect(packAdvantage(leader, stranger, [leader, stranger])).toBe("even");
  });

  it("faces the rivals off, then the outnumbered backs away", () => {
    const leader = animal(1, 10, 10);
    const allies = [animal(1, 9, 10), animal(1, 9, 11)];
    const rival = animal(2, 11.5, 10, Math.PI / 2);
    const all = [leader, ...allies, rival];
    const skirmish = vi.fn();
    updatePackDynamics(all, 0.2, { skirmish });

    // A stare: both stand facing each other, sparks between them.
    expect(skirmish).toHaveBeenCalledTimes(1);
    expect(skirmish).toHaveBeenCalledWith(10.75, 10);
    expect(leader.motion.mode).toBe("pause");
    expect(rival.motion.mode).toBe("pause");
    expect(off(leader.motion.look, 0)).toBeLessThan(1e-9);
    expect(off(rival.motion.look, Math.PI)).toBeLessThan(1e-9);

    // The stare over: the lone rival backs away, as far as its leash lets it.
    updatePackDynamics(all, STARE_S, { skirmish });
    expect(rival.motion.mode).toBe("stroll");
    expect(rival.motion.goal.x).toBeGreaterThan(11.5);
    expect(rival.motion.goal.x - 11.5).toBeLessThanOrEqual(RETREAT_CELLS);
    expect(withinLeash(rival)).toBe(true);
    expect(leader.motion.mode).toBe("pause");
    // Rested a while: no second face-off at once.
    expect(skirmish).toHaveBeenCalledTimes(1);
  });

  it("lets an even face-off end with neither backing away", () => {
    const a = animal(1, 10, 10);
    const b = animal(2, 11.5, 10);
    updatePackDynamics([a, b], 0.2);
    updatePackDynamics([a, b], STARE_S);
    expect(a.motion.mode).toBe("pause");
    expect(b.motion.mode).toBe("pause");
  });

  it("leaves busy animals and those walking to the sim's place alone", () => {
    const a = animal(1, 10, 10);
    const b = animal(2, 11.5, 10);
    const skirmish = vi.fn();
    updatePackDynamics([a, b], 0.2, { skirmish, idle: (m) => m !== b });
    expect(skirmish).not.toHaveBeenCalled();

    b.motion.mode = "travel";
    updatePackDynamics([a, b], 0.2, { skirmish });
    expect(skirmish).not.toHaveBeenCalled();
    expect(b.motion.mode).toBe("travel");
  });

  it("backs away only to where the body can stand", () => {
    const leader = animal(1, 10, 10);
    const allies = [animal(1, 9, 10), animal(1, 9, 11)];
    const rival = animal(2, 11.5, 10);
    const all = [leader, ...allies, rival];
    // Water east of x = 11.6: the rival cannot back away.
    const free = (_: PackMember, x: number): boolean => x <= 11.6;
    updatePackDynamics(all, 0.2, { free });
    updatePackDynamics(all, STARE_S, { free });
    expect(rival.motion.mode).toBe("pause");
  });

  it("triggers intra-species alpha duel between large adults near nest", () => {
    // 4 members make a nest at (10.5, 10.5)
    const a1 = animal(5, 10, 10);
    const a2 = animal(5, 11, 10);
    const a3 = animal(5, 10, 11);
    const a4 = animal(5, 11, 11);
    // Give a1 and a2 large adult size for alpha contention
    a1.plan.length = 1.5;
    a2.plan.length = 1.3;
    const skirmish = vi.fn();
    updatePackDynamics([a1, a2, a3, a4], 0.2, { skirmish });

    // Stare phase begins with sparks
    expect(skirmish).toHaveBeenCalled();
    expect(a1.motion.mode).toBe("pause");
    expect(a2.motion.mode).toBe("pause");
    expect(a1.pack.stare).toBeGreaterThan(0);
    expect(a2.pack.retreats).toBe(true); // a2 has smaller length (1.3 < 1.5), loses
  });

  it("wakes paused member when multiple pack mates are strolling", () => {
    const sleeper = animal(1, 10, 10);
    const walker1 = animal(1, 11, 10);
    const walker2 = animal(1, 10, 11);
    walker1.motion.mode = "stroll";
    walker1.motion.goal = { x: 12, y: 10 };
    walker2.motion.mode = "stroll";
    walker2.motion.goal = { x: 11, y: 11 };

    updatePackDynamics([sleeper, walker1, walker2], 0.2);
    expect(sleeper.motion.mode).toBe("stroll");
    expect(withinLeash(sleeper)).toBe(true);
  });
});
