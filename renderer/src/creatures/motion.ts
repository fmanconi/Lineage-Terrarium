/**
 * Life between sim ticks. The sim moves an animal every ten sim-minutes, a fraction of
 * a cell at a time; watched in real time that is stillness. Here an animal keeps to the
 * place the sim last gave it (its anchor) and lives there: it walks to a new anchor when
 * one comes, then pauses, looks about, and strolls a little around it, never further than
 * its leash. Where it is drawn is cosmetic; where it is, is the sim's.
 *
 * Pure: the caller owns the head and heading of the body's chain and a random stream,
 * and says which places the body can stand on. Nothing here allocates per frame.
 */
import { withinTurn, type Point } from "./chain";

/** How far (cells) an animal strays from its anchor: this, and this much per body length. */
const LEASH_BASE = 0.4;
const LEASH_PER_LENGTH = 0.6;
/** Further than this (cells) from its anchor, it is put there at once: it is a new arrival or the camera cut. */
const SNAP_CELLS = 12;
/** Close enough to where it is going, as a share of its body length. */
const ARRIVED_SHARE = 0.15;
/** Behind by more than this many leashes, it hurries: up to `HURRY` times its pace. */
const HURRY_FROM_LEASHES = 3;
const HURRY = 2;
/** Strolls are slower than walking to a new place. */
const STROLL_PACE = 0.55;
/** Seconds a pause lasts, from and to. */
const PAUSE_MIN_S = 1.5;
const PAUSE_MAX_S = 5;
/** After a pause, the chance it strolls rather than pausing again. */
const STROLL_CHANCE = 0.6;
/** Places tried when choosing where to stroll to. */
const STROLL_TRIES = 8;
/** Places along the way to a stroll's goal that must be free too, besides the goal (R5). */
const STROLL_CHECKS = 3;
/**
 * The Purposeful Wanderer mod (`mods/builtin/wanderer.ts`): a stroll goes on ahead, within
 * this much either side of the heading (radians), and each try that finds the way blocked
 * widens the cone by this much more, up to all the way round; a stroll goes at least this
 * share of the leash; paused, the head looks about only this far either side.
 */
const WANDER_CONE = Math.PI / 3;
const WANDER_WIDEN = Math.PI / 6;
const WANDER_LEAST_SHARE = 0.4;
const WANDER_LOOK_SPAN = Math.PI / 12;
/**
 * Walking to where the sim has it, it looks this share of its body length ahead (R5); what
 * is in the way there it walks round, turning aside by `STEER_STEP` (radians) at a time,
 * up to `STEER_TRIES` times either way; with no way round, it goes straight on.
 */
const STEER_AHEAD_SHARE = 0.6;
const STEER_STEP = Math.PI / 8;
const STEER_TRIES = 5;
/** Facing its way round within half a turn aside (the cosine of it), it walks on. */
const TURNED = Math.cos(STEER_STEP / 2);
/**
 * Moving its anchor off what it cannot stand on (R5): rings this far apart (cells), out
 * to `CLEAR_REACH`, each tried at `CLEAR_ANGLES` places.
 */
const CLEAR_STEP = 0.08;
const CLEAR_REACH = 1.6;
const CLEAR_ANGLES = 12;
/**
 * The anchor goes on past the first clear place, outward, by this share of the body's
 * length where it can: room for the body behind the head as it walks out.
 */
const CLEAR_BEYOND_SHARE = 0.7;
/**
 * Paused with its body in a plant behind it, it steps on by this share of its length,
 * straight ahead or turned aside by up to `STEP_OUT_TRIES` steps of `STEER_STEP`.
 */
const STEP_OUT_SHARE = 0.6;
const STEP_OUT_TRIES = 4;
/** How fast it turns toward where it is going, and while looking about (radians a second). */
const TURN_RATE = 3;
const LOOK_RATE = 1.2;
/** How far it looks either way while it pauses (radians). */
const LOOK_SPAN = 0.7;
/** A breath: seconds at mass 1, growing with the fourth root of mass (as heart rates slow). */
const BREATH_S = 2.4;
const BREATH_MASS_EXPONENT = 0.25;
/**
 * A young one trailing its mother (R5, `family.ts`): the place it keeps to behind her is
 * kept within this share of its leash of where the sim has it; further from that place
 * than this share of its length, it walks after her, and further than `TROT_FROM_LENGTHS`
 * of its lengths, it trots, at `TROT` times its pace.
 */
const TRAIL_LEASH_SHARE = 0.85;
const TRAIL_SLACK_SHARE = 0.5;
const TROT_FROM_LENGTHS = 1.2;
const TROT = 1.4;
/**
 * Walking to a new place from the sim, it makes for the place behind her there instead,
 * taken again whenever that has moved this far (cells) from where it is making for.
 */
const TRAIL_REGOAL_CELLS = 0.3;

export type Mode = "travel" | "stroll" | "pause";

export interface Motion {
  /** Where the sim says the animal is, in cells. */
  anchor: Point;
  mode: Mode;
  /** Where it is walking to (travel, stroll). */
  goal: Point;
  /** Seconds left of a pause. */
  timer: number;
  /** The heading it turns its head toward while it pauses. */
  look: number;
  /** The heading it had when the pause began: it looks about either side of it. */
  facing: number;
  /** The side it last turned aside to round what was in its way (1 or -1), 0 for none. */
  side: number;
  /** No clear place was found near the anchor (`clearAnchor`): not looked for again until it moves. */
  hemmed: boolean;
  /**
   * The way round what is in its way to the goal it travels to (R5: through bushes it
   * walked in, and was drawn inside them): the places to pass, the next first; planned
   * for `routeFor`, planned again when the goal moves.
   */
  route: Point[];
  routeFor: Point | null;
  /**
   * Trailing another (R5: a young one its mother, `trail`): the place it keeps to, within
   * its leash, and whether it does.
   */
  follow: Point;
  following: boolean;
  /** Where behind her it last made for, walking to a new place (`TRAIL_REGOAL_CELLS`). */
  aimed: Point;
}

/** What `drive` needs of the body. */
export interface Walker {
  head: Point;
  heading: number;
  /** Cells a second at its walking pace. */
  pace: number;
  /** Head to tail, cells. */
  length: number;
  /**
   * A body that bends only so far: which way the body behind the head points (radians),
   * how far the head may turn from it, and the tightest circle (radius, cells) it can walk
   * so. Left out, the head turns as it likes.
   */
  neck?: number;
  bend?: number;
  turning?: number;
}

let purposefulWandererActive = false;

/** Switch the Purposeful Wanderer mod's way of strolling on or off (renderer only). */
export function setPurposefulWanderer(active: boolean): void {
  purposefulWandererActive = active;
}

export function isPurposefulWanderer(): boolean {
  return purposefulWandererActive;
}

export function leash(length: number): number {
  return LEASH_BASE + LEASH_PER_LENGTH * length;
}

/** Whether an animal whose head is at `head` hurries to where the sim has it (R5: dust at its feet). */
export function hurries(motion: Motion, head: Point, length: number): boolean {
  if (motion.mode !== "travel") return false;
  const behind = Math.hypot(head.x - motion.anchor.x, head.y - motion.anchor.y) / leash(length);
  return behind > HURRY_FROM_LEASHES;
}

export function newMotion(anchor: Point, heading: number): Motion {
  return {
    anchor: { x: anchor.x, y: anchor.y },
    mode: "pause",
    goal: { x: anchor.x, y: anchor.y },
    timer: 0,
    look: heading,
    facing: heading,
    side: 0,
    hemmed: false,
    route: [],
    routeFor: null,
    follow: { x: anchor.x, y: anchor.y },
    following: false,
    aimed: { x: anchor.x, y: anchor.y },
  };
}

/**
 * From now on it keeps near (x, y) as it strolls (R5: a young one behind its mother),
 * never further from where the sim has it than its leash allows: the place is drawn in
 * toward the anchor as far as it must be. Called each frame while it trails.
 */
export function trail(motion: Motion, length: number, x: number, y: number): void {
  const { anchor, follow } = motion;
  const most = TRAIL_LEASH_SHARE * leash(length);
  const far = Math.hypot(x - anchor.x, y - anchor.y);
  const share = far > most ? most / far : 1;
  follow.x = anchor.x + (x - anchor.x) * share;
  follow.y = anchor.y + (y - anchor.y) * share;
  motion.following = true;
}

/** A new place from the sim. Returns true if the body must be put there at once (`snap`). */
export function reanchor(motion: Motion, walker: Walker, x: number, y: number): boolean {
  motion.anchor.x = x;
  motion.anchor.y = y;
  motion.hemmed = false;
  const far = Math.hypot(x - walker.head.x, y - walker.head.y);
  if (far > SNAP_CELLS) {
    walker.head.x = x;
    walker.head.y = y;
    pause(motion, walker.heading, 0);
    return true;
  }
  // On its way somewhere already, or now out of reach: it goes to the new place.
  if (motion.mode === "travel" || far > leash(walker.length)) travel(motion, x, y);
  return false;
}

/** Turn `from` toward `to` by at most `rate × dtS`; angles in radians. */
function turnToward(from: number, to: number, rate: number, dtS: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const most = rate * dtS;
  return from + Math.min(Math.max(difference, -most), most);
}

function travel(motion: Motion, x: number, y: number): void {
  motion.mode = "travel";
  motion.goal.x = x;
  motion.goal.y = y;
}

function pause(motion: Motion, heading: number, seconds: number): void {
  motion.mode = "pause";
  motion.timer = seconds;
  motion.facing = heading;
  motion.look = heading;
}

/**
 * Move the walker on by `dtS` seconds. `free` says whether the body can stand at a place;
 * `ground` whether the place itself is one it lives on (land, or water for a swimmer),
 * whatever stands there: where `ground` holds and `free` does not, a plant is in the way,
 * which a walk to the anchor goes round (R5). Returns the distance walked, in cells (for
 * what keeps time with steps, such as strokes).
 */
export function drive(
  motion: Motion,
  walker: Walker,
  dtS: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
  ground: (x: number, y: number) => boolean = free,
): number {
  const { head, length } = walker;
  const reach = leash(length);
  const fromAnchor = Math.hypot(head.x - motion.anchor.x, head.y - motion.anchor.y);
  // Wandered or pushed too far: back to where the sim has it.
  if (motion.mode !== "travel" && fromAnchor > reach) {
    travel(motion, motion.anchor.x, motion.anchor.y);
  }
  // Standing in a plant (one grew there, or it was put there): it walks out to its anchor,
  // if the anchor is clear and not where it stands already.
  if (
    motion.mode !== "travel" &&
    fromAnchor > ARRIVED_SHARE * length &&
    ground(head.x, head.y) &&
    !free(head.x, head.y) &&
    free(motion.anchor.x, motion.anchor.y)
  ) {
    travel(motion, motion.anchor.x, motion.anchor.y);
  }

  // Trailing (R5): it goes after the place it keeps to as soon as it is left behind, and
  // strolls only there.
  const { follow } = motion;
  const behindBy = motion.following ? Math.hypot(follow.x - head.x, follow.y - head.y) : 0;
  if (motion.following && motion.mode !== "travel") {
    if (motion.mode === "stroll" || behindBy > TRAIL_SLACK_SHARE * length) {
      motion.mode = "stroll";
      motion.goal.x = follow.x;
      motion.goal.y = follow.y;
    }
  } else if (
    motion.following &&
    Math.hypot(follow.x - motion.aimed.x, follow.y - motion.aimed.y) > TRAIL_REGOAL_CELLS
  ) {
    motion.goal.x = motion.aimed.x = follow.x;
    motion.goal.y = motion.aimed.y = follow.y;
  }

  if (motion.mode === "pause") {
    motion.timer -= dtS;
    // Looking about: now and then a new direction near the one it faced.
    // With the Purposeful Wanderer mod, only a little way either side: no turning on the spot.
    const span = purposefulWandererActive ? WANDER_LOOK_SPAN : LOOK_SPAN;
    if (random() < dtS / 1.2) motion.look = motion.facing + (random() * 2 - 1) * span;
    // Only the head turns: the body stays as it stood.
    walker.heading = keep(walker, turnToward(walker.heading, motion.look, LOOK_RATE, dtS));
    if (motion.timer <= 0) {
      if (
        !motion.following &&
        random() < STROLL_CHANCE &&
        chooseStroll(motion, walker.head, walker.heading, reach, random, free)
      ) {
        motion.mode = "stroll";
      } else {
        pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
      }
    }
    return 0;
  }

  const left = Math.hypot(motion.goal.x - head.x, motion.goal.y - head.y);
  if (left <= ARRIVED_SHARE * length) {
    pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
    return 0;
  }
  // Going to where the sim has it, it follows a way planned round the trees and bushes
  // (R5), from one place to pass to the next; with none found, it steers as it goes.
  const target = motion.mode === "travel" ? waypoint(motion, head, free) : motion.goal;
  const dx = target.x - head.x;
  const dy = target.y - head.y;
  const direct = Math.atan2(dy, dx);
  const way =
    motion.mode === "travel"
      ? steer(motion, head, direct, Math.min(STEER_AHEAD_SHARE * length, left), free, ground)
      : direct;
  // With no way round what is in its way, it goes straight on.
  const noWay = Number.isNaN(way);
  const toward = noWay ? direct : way;
  // A place inside the circles it turns on cannot be reached by turning: a stroll stops
  // short of it, a walk to where the sim has it goes on ahead until it can turn there.
  const within = inside(walker, motion.goal);
  if (within && motion.mode === "stroll") {
    pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
    return 0;
  }
  if (!within) {
    walker.heading = keep(walker, turnToward(walker.heading, toward, TURN_RATE, dtS));
  }
  const behind = motion.mode === "travel" ? fromAnchor / reach : 0;
  const hurry = behind > HURRY_FROM_LEASHES ? Math.min(HURRY, behind / HURRY_FROM_LEASHES) : 1;
  // A young one left behind walks after its mother, and trots to catch up (R5).
  const trailing = motion.following && motion.mode === "stroll";
  const stroll = trailing ? (behindBy > TROT_FROM_LENGTHS * length ? TROT : 1) : STROLL_PACE;
  const pace = walker.pace * (motion.mode === "stroll" ? stroll : hurry);
  // Walk the way it faces, slowing while it still faces away from its goal.
  const facing = Math.max(0, Math.cos(toward - walker.heading));
  // And slowing as a near place comes round to its side: at a full pace the circle its
  // turning allows (pace / TURN_RATE) can be wider than the way there, and it would circle
  // the place for ever instead of reaching it (measured 08/11/2026: at 2 cells a second a
  // place 0.6 cells off to the side was circled three times in ten seconds, never reached).
  // The pace is held to the one whose tightest circle still passes through the place.
  const off = Math.abs(
    Math.atan2(Math.sin(toward - walker.heading), Math.cos(toward - walker.heading)),
  );
  const near = Math.hypot(dx, dy);
  const room = off >= Math.PI / 2 ? near / 2 : near / (2 * Math.max(Math.sin(off), 1e-6));
  const turnable = Math.min(pace, TURN_RATE * room);
  const stride = Math.min(turnable * dtS * (0.25 + 0.75 * facing), left);
  const x = head.x + Math.cos(walker.heading) * stride;
  const y = head.y + Math.sin(walker.heading) * stride;
  // A stroll stops at what it cannot cross; going to where the sim has it never does.
  if (motion.mode === "stroll" && !free(x, y)) {
    pause(motion, walker.heading, PAUSE_MIN_S);
    return 0;
  }
  // Going there, it turns on the spot before it would step into a plant, if it has a way
  // round (R5) and is still turning to it; facing it, it walks on whatever is there.
  if (
    motion.mode === "travel" &&
    !noWay &&
    facing < TURNED &&
    ground(x, y) &&
    !free(x, y) &&
    free(head.x, head.y)
  ) {
    return 0;
  }
  head.x = x;
  head.y = y;
  return stride;
}

/** The routes' grid: cells to a step, how far round the way it may go, the most it plans. */
const ROUTE_STEP = 0.25;
const ROUTE_MARGIN = 2;
const ROUTE_MOST_CELLS = 8;
/** A place to pass counts as passed this near (cells). */
const WAYPOINT_REACHED = 0.2;
/** Line of sight between two places is checked this often (cells). */
const SIGHT_STEP = 0.12;

/** The next place to go to on the way to the motion's goal, planning the way if it has none. */
function waypoint(motion: Motion, head: Point, free: (x: number, y: number) => boolean): Point {
  const { goal } = motion;
  if (motion.routeFor === null || motion.routeFor.x !== goal.x || motion.routeFor.y !== goal.y) {
    motion.route = route(head, goal, free) ?? [];
    // A goal in a bush is moved to where the way ends, beside it.
    const end = motion.route[motion.route.length - 1];
    if (end !== undefined) {
      goal.x = end.x;
      goal.y = end.y;
    }
    motion.routeFor = { x: goal.x, y: goal.y };
  }
  while (motion.route.length > 0) {
    const next = motion.route[0];
    if (next === undefined || Math.hypot(next.x - head.x, next.y - head.y) > WAYPOINT_REACHED)
      break;
    motion.route.shift();
  }
  return motion.route[0] ?? goal;
}

/** The clear place nearest `p`, in rings `ROUTE_STEP` apart out to `ROUTE_MARGIN`; null if none. */
function nearestFree(p: Point, free: (x: number, y: number) => boolean): Point | null {
  for (let ring = ROUTE_STEP; ring <= ROUTE_MARGIN; ring += ROUTE_STEP) {
    const around = Math.max(8, Math.round((2 * Math.PI * ring) / ROUTE_STEP));
    for (let k = 0; k < around; k++) {
      const angle = (2 * Math.PI * k) / around;
      const x = p.x + Math.cos(angle) * ring;
      const y = p.y + Math.sin(angle) * ring;
      if (free(x, y)) return { x, y };
    }
  }
  return null;
}

/** Whether the straight way from `a` to `b` is clear all along. */
function inSight(a: Point, b: Point, free: (x: number, y: number) => boolean): boolean {
  const far = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(far / SIGHT_STEP));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    if (!free(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/**
 * A way from `from` to `to` round what `free` says the body cannot stand on: an A* search
 * over a grid of `ROUTE_STEP` cells about the two, in eight directions, then pulled
 * straight where the places on it can see each other. The places to pass, the last the
 * goal (or, if the goal cannot be stood on, the nearest place that can); null if there is
 * no way within reach.
 */
export function route(
  from: Point,
  goal: Point,
  free: (x: number, y: number) => boolean,
): Point[] | null {
  let to = goal;
  // A goal that cannot be stood on (in a bush) is reached at the nearest place that can.
  if (!free(to.x, to.y)) {
    const near = nearestFree(to, free);
    if (near === null) return null;
    to = near;
  }
  if (inSight(from, to, free)) return [to];
  if (Math.hypot(to.x - from.x, to.y - from.y) > ROUTE_MOST_CELLS) return null;
  const x0 = Math.min(from.x, to.x) - ROUTE_MARGIN;
  const y0 = Math.min(from.y, to.y) - ROUTE_MARGIN;
  const wide = Math.ceil((Math.max(from.x, to.x) + ROUTE_MARGIN - x0) / ROUTE_STEP) + 1;
  const tall = Math.ceil((Math.max(from.y, to.y) + ROUTE_MARGIN - y0) / ROUTE_STEP) + 1;
  const at = (i: number): Point => ({
    x: x0 + (i % wide) * ROUTE_STEP,
    y: y0 + Math.floor(i / wide) * ROUTE_STEP,
  });
  const indexOf = (p: Point): number =>
    Math.round((p.y - y0) / ROUTE_STEP) * wide + Math.round((p.x - x0) / ROUTE_STEP);
  const start = indexOf(from);
  const end = indexOf(to);
  const open = new Uint8Array(wide * tall); // 0 unknown, 1 open, 2 blocked
  const cost = new Float32Array(wide * tall).fill(Infinity);
  const came = new Int32Array(wide * tall).fill(-1);
  const done = new Uint8Array(wide * tall);
  const passable = (i: number): boolean => {
    if (i === start) return true;
    if (open[i] === 0) {
      const p = at(i);
      open[i] = free(p.x, p.y) ? 1 : 2;
    }
    return open[i] === 1;
  };
  const guess = (i: number): number => {
    const dx = Math.abs((i % wide) - (end % wide));
    const dy = Math.abs(Math.floor(i / wide) - Math.floor(end / wide));
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // A small binary heap of (score, index).
  const heap: number[] = [];
  const scores: number[] = [];
  const push = (i: number, score: number): void => {
    heap.push(i);
    scores.push(score);
    let k = heap.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if ((scores[up] ?? 0) <= score) break;
      [heap[k], heap[up]] = [heap[up] ?? 0, heap[k] ?? 0];
      [scores[k], scores[up]] = [scores[up] ?? 0, scores[k] ?? 0];
      k = up;
    }
  };
  const pop = (): number => {
    const top = heap[0] ?? -1;
    const lastI = heap.pop() ?? -1;
    const lastS = scores.pop() ?? 0;
    if (heap.length > 0) {
      heap[0] = lastI;
      scores[0] = lastS;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let small = k;
        if (l < heap.length && (scores[l] ?? 0) < (scores[small] ?? 0)) small = l;
        if (r < heap.length && (scores[r] ?? 0) < (scores[small] ?? 0)) small = r;
        if (small === k) break;
        [heap[k], heap[small]] = [heap[small] ?? 0, heap[k] ?? 0];
        [scores[k], scores[small]] = [scores[small] ?? 0, scores[k] ?? 0];
        k = small;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(start, guess(start));
  while (heap.length > 0) {
    const here = pop();
    if (here === end) break;
    if (done[here] === 1) continue;
    done[here] = 1;
    const hx = here % wide;
    const hy = Math.floor(here / wide);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = hx + dx;
        const ny = hy + dy;
        if (nx < 0 || ny < 0 || nx >= wide || ny >= tall) continue;
        const next = ny * wide + nx;
        if (done[next] === 1 || !passable(next)) continue;
        // No cutting a corner between two blocked steps.
        if (dx !== 0 && dy !== 0 && (!passable(hy * wide + nx) || !passable(ny * wide + hx)))
          continue;
        const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        const through = (cost[here] ?? Infinity) + step;
        if (through >= (cost[next] ?? Infinity)) continue;
        cost[next] = through;
        came[next] = here;
        push(next, through + guess(next));
      }
    }
  }
  if (came[end] === -1) return null;
  const path: Point[] = [];
  for (let i = end; i !== start && i !== -1; i = came[i] ?? -1) path.push(at(i));
  path.reverse();
  path[path.length - 1] = { x: to.x, y: to.y };
  // Pulled straight: from each place, on to the furthest one it can see.
  const pulled: Point[] = [];
  let from_ = from;
  let k = 0;
  while (k < path.length) {
    let far = k;
    for (let j = path.length - 1; j > k; j--) {
      const p = path[j];
      if (p !== undefined && inSight(from_, p, free)) {
        far = j;
        break;
      }
    }
    const p = path[far];
    if (p === undefined) break;
    pulled.push(p);
    from_ = p;
    k = far + 1;
  }
  return pulled;
}

/** `heading`, as far round as the walker's neck lets it turn from its body. */
function keep(walker: Walker, heading: number): number {
  const { neck, bend } = walker;
  return neck === undefined || bend === undefined ? heading : withinTurn(heading, neck, bend);
}

/** Whether `goal` lies inside one of the two circles the walker turns on at its tightest. */
function inside(walker: Walker, goal: Point): boolean {
  const radius = walker.turning ?? 0;
  if (radius <= 0) return false;
  const { head, heading } = walker;
  // The circles' centres lie to either side of the head, `radius` away.
  const sideX = -Math.sin(heading) * radius;
  const sideY = Math.cos(heading) * radius;
  const leftX = goal.x - head.x - sideX;
  const leftY = goal.y - head.y - sideY;
  const rightX = goal.x - head.x + sideX;
  const rightY = goal.y - head.y + sideY;
  const squared = radius * radius;
  return leftX * leftX + leftY * leftY < squared || rightX * rightX + rightY * rightY < squared;
}

/**
 * The way to head for `toward` (radians), round a plant in the way `ahead` cells on: the
 * nearest heading either side that is free there, the side turned to last time first;
 * NaN if there is none. Only plants are walked round; across water or off it, it goes
 * straight on as before.
 */
function steer(
  motion: Motion,
  head: Point,
  toward: number,
  ahead: number,
  free: (x: number, y: number) => boolean,
  ground: (x: number, y: number) => boolean,
): number {
  const x = head.x + Math.cos(toward) * ahead;
  const y = head.y + Math.sin(toward) * ahead;
  if (free(x, y) || !ground(x, y)) {
    motion.side = 0;
    return toward;
  }
  const first = motion.side === 0 ? 1 : motion.side;
  for (let k = 1; k <= STEER_TRIES; k++) {
    for (let turn = 0; turn < 2; turn++) {
      const side = turn === 0 ? first : -first;
      const angle = toward + side * k * STEER_STEP;
      if (free(head.x + Math.cos(angle) * ahead, head.y + Math.sin(angle) * ahead)) {
        motion.side = side;
        return angle;
      }
    }
  }
  return Number.NaN;
}

/**
 * Put the anchor of `motion` on the nearest place `free` says the body can stand on (R5:
 * the sim may have an animal in a wood, where it is drawn beside a trunk, not on it), and
 * a walk to the anchor goes there instead. Returns false if none is near; it then stays,
 * and is not looked for again until the sim moves it.
 */
export function clearAnchor(
  motion: Motion,
  free: (x: number, y: number) => boolean,
  length: number,
): boolean {
  const { anchor } = motion;
  if (motion.hemmed || free(anchor.x, anchor.y)) return !motion.hemmed;
  for (let ring = CLEAR_STEP; ring <= CLEAR_REACH; ring += CLEAR_STEP) {
    for (let k = 0; k < CLEAR_ANGLES; k++) {
      const angle = (2 * Math.PI * k) / CLEAR_ANGLES;
      const x = anchor.x + Math.cos(angle) * ring;
      const y = anchor.y + Math.sin(angle) * ring;
      if (!free(x, y)) continue;
      const further = ring + CLEAR_BEYOND_SHARE * length;
      const fx = anchor.x + Math.cos(angle) * further;
      const fy = anchor.y + Math.sin(angle) * further;
      const room = free(fx, fy);
      anchor.x = room ? fx : x;
      anchor.y = room ? fy : y;
      if (motion.mode === "travel") travel(motion, anchor.x, anchor.y);
      return true;
    }
  }
  motion.hemmed = true;
  return false;
}

/**
 * Paused with its head clear and its body in a plant (R5), it strolls on a little, to the
 * first place ahead or nearly ahead that `free` says it can stand on.
 */
export function stepOut(
  motion: Motion,
  walker: Walker,
  free: (x: number, y: number) => boolean,
): void {
  if (motion.mode !== "pause") return;
  const { head, heading, length } = walker;
  const ahead = STEP_OUT_SHARE * length;
  for (let k = 0; k <= STEP_OUT_TRIES; k++) {
    for (let turn = 0; turn < (k === 0 ? 1 : 2); turn++) {
      const angle = heading + (turn === 0 ? k : -k) * STEER_STEP;
      const x = head.x + Math.cos(angle) * ahead;
      const y = head.y + Math.sin(angle) * ahead;
      if (!free(x, y)) continue;
      motion.mode = "stroll";
      motion.goal.x = x;
      motion.goal.y = y;
      return;
    }
  }
}

/**
 * Pick a place within the leash that the body can stand on; false if none was found.
 * Anywhere round the anchor; with the Purposeful Wanderer mod, ahead of the head within
 * a cone about `heading` that widens with each blocked try.
 */
export function chooseStroll(
  motion: Motion,
  head: Point,
  heading: number,
  reach: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
): boolean {
  for (let attempt = 0; attempt < STROLL_TRIES; attempt++) {
    let x: number;
    let y: number;
    if (purposefulWandererActive) {
      const cone = Math.min(Math.PI, WANDER_CONE + attempt * WANDER_WIDEN);
      const angle = heading + (random() * 2 - 1) * cone;
      const distance = reach * lerp(WANDER_LEAST_SHARE, 1, random());
      x = head.x + Math.cos(angle) * distance;
      y = head.y + Math.sin(angle) * distance;
      // Never past the leash: near its end, a wider try turns it back.
      if (Math.hypot(x - motion.anchor.x, y - motion.anchor.y) > reach) continue;
    } else {
      const angle = random() * 2 * Math.PI;
      const distance = reach * Math.sqrt(random());
      x = motion.anchor.x + Math.cos(angle) * distance;
      y = motion.anchor.y + Math.sin(angle) * distance;
    }
    // The goal and the way there clear (R5), so that it does not stop short at a bush.
    let clear = free(x, y);
    for (let k = 1; clear && k <= STROLL_CHECKS; k++) {
      const t = k / (STROLL_CHECKS + 1);
      clear = free(lerp(head.x, x, t), lerp(head.y, y, t));
    }
    if (clear) {
      motion.goal.x = x;
      motion.goal.y = y;
      return true;
    }
  }
  return false;
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Seconds a breath takes for an animal of `mass`. */
export function breathPeriod(mass: number): number {
  return BREATH_S * Math.max(mass, 1e-3) ** BREATH_MASS_EXPONENT;
}

/** How full its chest is at time `t` seconds, 0–1, starting from `offset` (0–1) into a breath. */
export function breath(t: number, mass: number, offset = 0): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / breathPeriod(mass) + offset));
}
