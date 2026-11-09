/**
 * The Packs and Rivals mod (`mods/builtin/pack-warfare.ts`). Animals of
 * one species near each other go about as a pack (boids): a stroll leans the way the pack
 * faces (alignment), away from a mate too close (separation), and back toward its mates
 * when it has strayed (cohesion); a pack of four or more keeps a nest at its middle, which
 * mothers and the young keep near while the other adults go round its rim. Animals of two
 * species meeting face each other a moment, with sparks between them, and the side with
 * fewer allies near backs away (the pack's advantage).
 *
 * Drawing only: everything here steers where an animal strolls about the place the sim
 * has it (`motion.ts`), never past its leash; where it is stays the sim's. Pure: no clock,
 * no random draws; the caller says which places a body can stand on and which animals are
 * free to be steered, and draws the nests and the sparks.
 */
import type { Point } from "./chain";
import { leash, type Mode, type Motion } from "./motion";

/** Mates closer than this (cells, head to head) make one pack; allies are counted within it. */
export const PACK_CELLS = 3;
/** Further than this (cells) from its mates' middle, an animal's next stroll goes back toward them. */
export const STRAY_CELLS = 4;
/** How far (cells) a strayed animal looks for its mates. */
const SIGHT_CELLS = 8;
/** A pack this many strong keeps a nest at its middle. */
export const NEST_MEMBERS = 4;
/** Adults within this (cells) of their nest stroll out toward its rim. */
const NEST_RIM_CELLS = 2;
/** Animals of two species closer than this (cells, head to head) face off. */
export const RIVAL_CELLS = 2;
/** Too close to a mate: within this share of the two bodies' mean length, at least `PERSONAL_LEAST`. */
const PERSONAL_SHARE = 0.6;
const PERSONAL_LEAST = 0.35;
/** Seconds two rivals stare at each other before the weaker side backs away. */
export const STARE_S = 0.8;
/** How far (cells) the weaker backs away, as far as its leash lets it. */
export const RETREAT_CELLS = 2.5;
/** Seconds after a face-off before either of the two faces off again. */
const STANDOFF_REST_S = 6;
/** A paused animal turns its look toward the pack's heading by at most this much (radians) a pass. */
const ALIGN_TURN = Math.PI / 4;
/** How much each pull weighs in a stroll's new way, against the way it chose itself (1). */
const W_ALIGN = 1;
const W_SEPARATE = 2;
const W_COHERE = 3;
const W_NEST = 1.5;
/** Goals are kept within this share of the leash, short of where `drive` calls it back. */
const LEASH_KEEP = 0.95;
/** Strolls shorter than this (cells) are left as they are, and none so short is begun. */
const SHORTEST_STROLL = 0.05;
/** A step away or back shorter than this share of its length is not taken (hemmed in by its leash). */
const LEAST_STEP_SHARE = 0.15;

/** What the pack keeps of each animal between passes. */
export interface PackState {
  /** Its motion's mode at the last pass: a stroll begun since is steered once. */
  mode: Mode | null;
  /** Seconds left of a face-off's stare, and where its rival's head was. */
  stare: number;
  rival: Point;
  /** It lost the face-off: it backs away once the stare is over. */
  retreats: boolean;
  /** Seconds before it may face off again. */
  rest: number;
}

/** What the pack needs of an animal (the creature layer's own satisfy it). */
export interface PackMember {
  /** Its species: the sim's id, or any key one species shares. */
  species: number;
  /** Not grown yet (`growth < 1`). */
  young: boolean;
  /** A mother: tending a brood or trailed by a young one. */
  nurturing: boolean;
  /** Its chain, head first, in cells. */
  joints: Point[];
  heading: number;
  /** Anchored life (`motion.ts`); animals without it are left alone. */
  motion: Motion | null;
  plan: { length: number };
  pack: PackState;
}

/** A colony's nest: at the middle of where the sim has its members. */
export interface Nest {
  species: number;
  x: number;
  y: number;
  members: number;
}

export interface PackHooks<M extends PackMember> {
  /** Whether it is free to be steered (not hunting, eating, asleep, held…); all, if left out. */
  idle?: (member: M) => boolean;
  /** Whether its body can stand at (x, y); everywhere, if left out. */
  free?: (member: M, x: number, y: number) => boolean;
  /** Two rivals faced off, their heads either side of (x, y): sparks there. */
  skirmish?: (x: number, y: number) => void;
}

export function newPackState(): PackState {
  return { mode: null, stare: 0, rival: { x: 0, y: 0 }, retreats: false, rest: 0 };
}

function headOf(member: PackMember): Point | undefined {
  return member.joints[0];
}

function apart(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The animals by species, in the order each species first comes (a Map keeps it). */
export function groupBySpecies<M extends PackMember>(
  members: readonly (M | undefined)[],
): Map<number, M[]> {
  const groups = new Map<number, M[]>();
  for (const member of members) {
    if (member === undefined) continue;
    const group = groups.get(member.species);
    if (group === undefined) groups.set(member.species, [member]);
    else group.push(member);
  }
  return groups;
}

/** The packs among animals of one species: those linked head to head within `PACK_CELLS`. */
export function findPacks<M extends PackMember>(species: readonly M[]): M[][] {
  const packs: M[][] = [];
  const taken = new Set<M>();
  for (const first of species) {
    if (taken.has(first)) continue;
    const pack = [first];
    taken.add(first);
    for (let k = 0; k < pack.length; k++) {
      const head = headOf(pack[k] as M);
      if (head === undefined) continue;
      for (const other of species) {
        const there = headOf(other);
        if (taken.has(other) || there === undefined || apart(head, there) >= PACK_CELLS) continue;
        taken.add(other);
        pack.push(other);
      }
    }
    packs.push(pack);
  }
  return packs;
}

/** The way a group faces on average (radians); NaN for none, or headings that cancel out. */
export function meanHeading(members: readonly PackMember[]): number {
  let x = 0;
  let y = 0;
  for (const member of members) {
    x += Math.cos(member.heading);
    y += Math.sin(member.heading);
  }
  return Math.hypot(x, y) < 1e-9 ? Number.NaN : Math.atan2(y, x);
}

/** How many of `member`'s species have their heads within `PACK_CELLS` of its own. */
export function alliesNear(
  member: PackMember,
  members: readonly (PackMember | undefined)[],
): number {
  const head = headOf(member);
  if (head === undefined) return 0;
  let allies = 0;
  for (const other of members) {
    if (other === undefined || other === member || other.species !== member.species) continue;
    const there = headOf(other);
    if (there !== undefined && apart(head, there) < PACK_CELLS) allies++;
  }
  return allies;
}

/** Who wins a face-off between `a` and `b`: the side with more allies near, or neither. */
export function packAdvantage(
  a: PackMember,
  b: PackMember,
  members: readonly (PackMember | undefined)[],
): "a" | "b" | "even" {
  const ours = alliesNear(a, members);
  const theirs = alliesNear(b, members);
  return ours > theirs ? "a" : theirs > ours ? "b" : "even";
}

/** `point` drawn in toward the anchor as far as it must be to lie within the animal's leash. */
function withinLeash(motion: Motion, length: number, point: Point): void {
  const { anchor } = motion;
  const most = LEASH_KEEP * leash(length);
  const far = apart(point, anchor);
  if (far <= most) return;
  point.x = anchor.x + ((point.x - anchor.x) * most) / far;
  point.y = anchor.y + ((point.y - anchor.y) * most) / far;
}

/** Turn `from` toward `to` by at most `most` (radians). */
function turnToward(from: number, to: number, most: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.min(Math.max(difference, -most), most);
}

/** Stand still a while facing (x, y). */
function face(motion: Motion, head: Point, x: number, y: number, seconds: number): void {
  const toward = Math.atan2(y - head.y, x - head.x);
  motion.mode = "pause";
  motion.timer = Math.max(motion.timer, seconds);
  motion.look = toward;
  motion.facing = toward;
}

/** Stroll to `goal` (within the leash) if the body can stand there; whether it does. */
function strollTo<M extends PackMember>(
  member: M,
  motion: Motion,
  goal: Point,
  free: (member: M, x: number, y: number) => boolean,
): boolean {
  withinLeash(motion, member.plan.length, goal);
  const head = headOf(member);
  if (head === undefined || apart(goal, head) < LEAST_STEP_SHARE * member.plan.length) return false;
  if (!free(member, goal.x, goal.y)) return false;
  motion.mode = "stroll";
  motion.goal.x = goal.x;
  motion.goal.y = goal.y;
  return true;
}

/**
 * One pass of the packs over `members` (the layer's slots; empty ones undefined), `dtS`
 * seconds after the last: face-offs begun and played out, strolls begun since steered,
 * paused animals turned toward their pack's heading or away from a mate too close.
 * Returns the colonies' nests, for the caller to draw.
 */
export function updatePackDynamics<M extends PackMember>(
  members: readonly (M | undefined)[],
  dtS: number,
  hooks: PackHooks<M> = {},
): Nest[] {
  const idle = hooks.idle ?? (() => true);
  const free = hooks.free ?? (() => true);
  const living = members.filter(
    (member): member is M =>
      member !== undefined && member.motion !== null && headOf(member) !== undefined,
  );
  for (const member of living) {
    member.pack.stare -= dtS;
    member.pack.rest -= dtS;
  }

  // Packs and their nests.
  const packOf = new Map<M, M[]>();
  const nestOf = new Map<M, Nest>();
  const nests: Nest[] = [];
  const bySpecies = groupBySpecies(living);
  for (const [species, group] of bySpecies) {
    for (const pack of findPacks(group)) {
      for (const member of pack) packOf.set(member, pack);
      if (pack.length < NEST_MEMBERS) continue;
      let x = 0;
      let y = 0;
      for (const member of pack) {
        x += member.motion?.anchor.x ?? 0;
        y += member.motion?.anchor.y ?? 0;
      }
      const nest = { species, x: x / pack.length, y: y / pack.length, members: pack.length };
      nests.push(nest);
      for (const member of pack) nestOf.set(member, nest);
    }
  }

  // Face-offs: two animals of two species near each other, both free and rested, neither
  // on its way to a new place from the sim.
  const ready = (member: M): boolean =>
    member.pack.rest <= 0 && member.motion?.mode !== "travel" && idle(member);
  const facing = new Set<M>();
  for (let i = 0; i < living.length; i++) {
    const a = living[i] as M;
    const ah = headOf(a) as Point;
    if (facing.has(a) || !ready(a)) continue;
    for (let j = i + 1; j < living.length; j++) {
      const b = living[j] as M;
      const bh = headOf(b) as Point;
      if (facing.has(b)) continue;
      const sameSpecies = b.species === a.species;
      if (sameSpecies) {
        // Intra-species ritual duel for Alpha role: mature adults near nest
        const nestA = nestOf.get(a);
        const nearNest = nestA !== undefined && apart(ah, nestA) <= 3.5;
        const isAlphaDuel =
          nearNest &&
          !a.young &&
          !b.young &&
          !a.nurturing &&
          !b.nurturing &&
          (a.plan.length >= 1.2 || b.plan.length >= 1.2);
        if (!isAlphaDuel) continue;
      }
      if (apart(ah, bh) >= RIVAL_CELLS || !ready(b)) continue;
      const winner = sameSpecies
        ? a.plan.length > b.plan.length
          ? "a"
          : b.plan.length > a.plan.length
            ? "b"
            : "even"
        : packAdvantage(a, b, living);
      const stareTime = sameSpecies ? 1.2 : STARE_S;
      const restTime = sameSpecies ? 60 : STANDOFF_REST_S;
      for (const [one, other, loses] of [
        [a, bh, winner === "b"],
        [b, ah, winner === "a"],
      ] as const) {
        one.pack.stare = stareTime;
        one.pack.rest = restTime;
        one.pack.rival.x = other.x;
        one.pack.rival.y = other.y;
        one.pack.retreats = loses;
        facing.add(one);
      }
      hooks.skirmish?.((ah.x + bh.x) / 2, (ah.y + bh.y) / 2);
      break;
    }
  }

  const goal: Point = { x: 0, y: 0 };
  for (const member of living) {
    const motion = member.motion as Motion;
    const head = headOf(member) as Point;
    const state = member.pack;
    const was = state.mode;
    state.mode = motion.mode;
    // Busy, or called away by the sim: a face-off under way is dropped.
    if (!idle(member) || motion.mode === "travel") {
      state.stare = 0;
      state.retreats = false;
      continue;
    }
    // Staring the rival down, then (the weaker) backing away from where it stood.
    if (state.stare > 0) {
      face(motion, head, state.rival.x, state.rival.y, state.stare);
      state.mode = motion.mode;
      continue;
    }
    if (state.retreats) {
      state.retreats = false;
      const away = Math.atan2(head.y - state.rival.y, head.x - state.rival.x);
      goal.x = head.x + Math.cos(away) * RETREAT_CELLS;
      goal.y = head.y + Math.sin(away) * RETREAT_CELLS;
      if (strollTo(member, motion, goal, free)) state.mode = motion.mode;
      continue;
    }
    if (motion.following) continue;

    const pack = packOf.get(member) ?? [member];
    const mates = pack.filter((mate) => mate !== member);
    const personal = (mate: M): number =>
      Math.max(PERSONAL_LEAST, (PERSONAL_SHARE * (member.plan.length + mate.plan.length)) / 2);
    const crowding = mates.find((mate) => apart(head, headOf(mate) as Point) < personal(mate));

    if (motion.mode === "pause") {
      // Too close to a mate: a step away; otherwise it looks the way its pack faces.
      if (crowding !== undefined) {
        const there = headOf(crowding) as Point;
        const away = Math.atan2(head.y - there.y, head.x - there.x);
        const step = personal(crowding);
        goal.x = head.x + Math.cos(away) * step;
        goal.y = head.y + Math.sin(away) * step;
        if (strollTo(member, motion, goal, free)) state.mode = motion.mode;
        continue;
      }
      // Reactive wake from pause: if 2 or more mates in pack are strolling, wake up and follow
      const strollingMates = mates.filter((m) => m.motion?.mode === "stroll");
      if (strollingMates.length >= 2) {
        const heading = meanHeading(strollingMates);
        if (!Number.isNaN(heading)) {
          goal.x = head.x + Math.cos(heading) * member.plan.length * 1.5;
          goal.y = head.y + Math.sin(heading) * member.plan.length * 1.5;
          withinLeash(motion, member.plan.length, goal);
          if (strollTo(member, motion, goal, free)) {
            state.mode = motion.mode;
            continue;
          }
        }
      }
      const near = mates.filter((mate) => apart(head, headOf(mate) as Point) < PACK_CELLS);
      const heading = meanHeading(near);
      if (!Number.isNaN(heading)) {
        motion.facing = turnToward(motion.facing, heading, ALIGN_TURN);
      }
      continue;
    }

    // A stroll begun since the last pass: its way leant by the pack's pulls.
    if (motion.mode !== "stroll" || was === "stroll") continue;
    const length = apart(motion.goal, head);
    if (length < SHORTEST_STROLL) continue;
    let x = (motion.goal.x - head.x) / length;
    let y = (motion.goal.y - head.y) / length;
    // Alignment: the way its mates near face.
    const near = mates.filter((mate) => apart(head, headOf(mate) as Point) < PACK_CELLS);
    const heading = meanHeading(near);
    if (!Number.isNaN(heading)) {
      x += W_ALIGN * Math.cos(heading);
      y += W_ALIGN * Math.sin(heading);
    }
    // Separation: away from mates too close.
    for (const mate of mates) {
      const there = headOf(mate) as Point;
      const far = apart(head, there);
      if (far >= personal(mate) || far < 1e-9) continue;
      x += (W_SEPARATE * (head.x - there.x)) / far;
      y += (W_SEPARATE * (head.y - there.y)) / far;
    }
    // Cohesion: strayed from its mates in sight, back toward their middle.
    let mx = 0;
    let my = 0;
    let seen = 0;
    for (const mate of bySpecies.get(member.species) ?? []) {
      const there = headOf(mate) as Point;
      if (mate === member || apart(head, there) >= SIGHT_CELLS) continue;
      mx += there.x;
      my += there.y;
      seen++;
    }
    if (seen > 0) {
      const middle = { x: mx / seen, y: my / seen };
      const far = apart(head, middle);
      if (far > STRAY_CELLS) {
        x += (W_COHERE * (middle.x - head.x)) / far;
        y += (W_COHERE * (middle.y - head.y)) / far;
      }
    }
    // The nest: mothers and the young keep near it, the other adults go round its rim.
    const nest = nestOf.get(member);
    if (nest !== undefined) {
      const far = apart(head, nest);
      if (far > 1e-9) {
        const inward = member.young || member.nurturing;
        if (inward || far < NEST_RIM_CELLS) {
          const sign = inward ? 1 : -1;
          x += (sign * W_NEST * (nest.x - head.x)) / far;
          y += (sign * W_NEST * (nest.y - head.y)) / far;
        }
      }
    }
    const pull = Math.hypot(x, y);
    if (pull < 1e-9) continue;
    goal.x = head.x + (x / pull) * length;
    goal.y = head.y + (y / pull) * length;
    // Where the body cannot stand, the stroll goes as it chose.
    withinLeash(motion, member.plan.length, goal);
    if (free(member, goal.x, goal.y)) {
      motion.goal.x = goal.x;
      motion.goal.y = goal.y;
    }
  }
  return nests;
}
