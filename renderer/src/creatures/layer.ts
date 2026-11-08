/**
 * Creatures: a head that wanders, a chain of joints that follows it, and on that chain
 * whatever the body plan asks for: parts that ride the joints and legs that step.
 * Everything is a sprite of the atlas (tinted discs, wedges and stretched squares), so a
 * creature costs no geometry rebuild, only transforms.
 */
import { AlphaFilter, Container, Sprite, type Texture } from "pixi.js";
import { DISC_SIZE, type Atlas } from "./atlas";
import { FIRST_LOOK, LAYER, bodyPlan, type BodyOptions, type BodyPlan, type LegPlan } from "./body";
import type { CellRect } from "../terrain/land";
import {
  curl,
  followChain,
  neckDirection,
  pivot,
  solveKnee,
  stiffness,
  withinTurn,
  type Point,
  type Stiffness,
} from "./chain";
import {
  breath,
  clearAnchor,
  drive,
  hurries,
  newMotion,
  reanchor,
  stepOut,
  trail,
  type Motion,
  type Walker,
} from "./motion";
import {
  COURT_ANGLES,
  COURT_GAP_CELLS,
  COURT_HEARTS,
  COURT_HEARTS_FROM,
  COURT_LEAN_MOST,
  COURT_REACH_CELLS,
  COURT_TOUCH_S,
  COURT_TROT,
  COURT_WALK_LEAST_S,
  COURT_WALK_MARGIN,
  COURT_WALK_MOST_S,
  courtLean,
  FAMILY_NEAR_CELLS,
  trailSpot,
} from "./family";
import {
  breathClock,
  breathDepth,
  carrySleep,
  doze,
  rouse,
  sleeperOf,
  tuckOf,
  wakeNow,
  type Night,
  type Sleeper,
} from "./sleep";
import {
  HUDDLE_HEAD,
  HUDDLE_LOW,
  HUDDLE_SLOW,
  HUDDLE_STRIDE,
  HUDDLE_TUCK,
  Spray,
  drench,
  drenchOf,
  huddleToward,
  shiverAt,
  sprays,
  type Downpour,
  type Drench,
} from "./weather";
import { DYING, TINT_STEPS, mixColour, roundTexture, type Dying } from "./remains";
import { kindFor, speciesPlans, type SpeciesPlan } from "./species";
import {
  opacityUnderWater,
  seaKey,
  shadowUnderWater,
  underWater,
  type SeaAt,
  type WaterLook,
} from "./water";
import type { CreatureSeed } from "./seed";
import type { Footprints, Passable } from "./habitat";
import { dotOf, dotSize } from "./markers";
import { Flecks, bite, flecks, type Food } from "./eating";
import {
  BITE_INTO,
  DUST,
  KICKED,
  LUNGE_S,
  LUNGE_STRETCH,
  SPRING_SHARE,
  chase,
  lunge,
  strikeAfter,
  type Hunt,
} from "./hunting";
import {
  BESIDE_ANGLES,
  BESIDE_GAP,
  EGG_S,
  HATCH_S,
  MOMENT_S,
  NEWBORN_S,
  NUZZLE_REACH,
  NUZZLE_S,
  Nursery,
} from "./nursery";
import {
  RIPPLES,
  SWASH_SEA,
  bobAt,
  effortOf,
  paceIn,
  rippleAt,
  ringTexture,
  wetOf,
  type Wet,
} from "./wading";
import { MAP_TILE } from "../terrain/ground";
import {
  BASK_LOWERS,
  BASK_REACH,
  BASK_SPREADS,
  BASK_WIDENS,
  GLINT_COLOUR,
  bask,
  glintDue,
  glintKind,
  glintPlace,
  newBasker,
  sunny,
  type Basker,
} from "./basking";
import { Sparks, pixelTexture, type SparkKind } from "./sparks";
import { envenom } from "./venom";
import { WAKE_EVERY_PX, WAKE_FROM, wakePair } from "./wake";
import type { Random } from "../rng";
import { isChristmasActive } from "../mods/builtin/christmas";
import { isDramaticDirectorActive, dramaticDirector } from "../mods/builtin/dramatic-director";
import { isPackWarfareActive } from "../mods/builtin/pack-warfare";
import {
  newPackState,
  updatePackDynamics,
  type Nest,
  type PackHooks,
  type PackState,
} from "./pack";

/** Wandering: how fast the turn rate drifts and settles (per second). */
/**
 * An animal out of sight lives one update in this many, with the time of them all (R5,
 * the board): staggered across the herd, so a third of them each frame. "In sight" reaches
 * a body's length and a cell beyond the view, so it is back to every frame before it shows.
 */
const OUT_OF_SIGHT_EVERY = 3;
/**
 * In a view that asks for it (`posedSparsely`), an animal in sight is posed (legs, body,
 * breath) on two updates in three, staggered across the herd, with the time of the one it
 * missed: the owner's choice for the middle view, where an animal is a few art pixels long
 * (R5, the board: the crowded middle view came late; up close every update poses).
 */
const POSE_SKIP_EVERY = 3;
/**
 * The Packs and Rivals mod (`creatures/pack.ts`): the packs are looked
 * at once in this many seconds, not every frame (every pair of animals is compared).
 */
const PACK_EVERY_S = 0.2;
/** A face-off's sparks: this many, this colour, for this long (seconds), rising this fast (art pixels a second). */
const SKIRMISH_SPARKS = 3;
const SKIRMISH_COLOUR = 0xffd25a;
const SKIRMISH_S = 0.6;
const SKIRMISH_RISE = 6;
/** A nest's twigs and stones, on a 4×4 art-pixel patch with its corners left bare. */
const NEST_TWIGS = 0x7a5530;
const NEST_STONES = 0x9c968c;
const NEST_SHAPE = [".##.", "####", "####", ".##."];
/** How many ways a nest is laid out; a species always has the same one. */
const NEST_LOOKS = 8;

const TURN_JITTER = 6;
const TURN_DAMPING = 1.5;
const AVOID_TURN = 3.5;
const LOOK_AHEAD_CELLS = 1.2;
/**
 * Legs step in turn: the body goes once through its gait cycle for every so many lengths
 * of its shortest stepping leg that it walks, and each foot swings in its own part of the
 * cycle and stands still the rest of it.
 */
const STRIDE_LEGS = 1.5;
/** The share of the cycle a foot spends in the air. */
const SWING_SHARE = 0.4;
/**
 * The feet of a pair swing half a cycle apart, and so do the same side's feet of
 * neighbouring pairs (diagonal pairs together: a trot, a tripod); each pair behind the
 * first lifts this much of a cycle later than its diagonal partner in front.
 */
const PAIR_LAG = 0.06;
/** How high a foot is lifted at the middle of its swing, in leg lengths (toward the light). */
const FOOT_LIFT = 0.1;
/**
 * A body standing or creeping still steps at least once in so many seconds while a foot
 * is in the air or farther than `SETTLE_OFF` leg lengths from where it should stand, so
 * that it comes to rest with every foot down under it.
 */
const SETTLE_CYCLE_S = 0.8;
const SETTLE_OFF = 0.25;
/** A foot farther than so many leg lengths from its place (put somewhere new, or back in view) is put there. */
const SNAP_LEGS = 3;
/** The most of a cycle one frame may advance, so that a long frame skips no foot's swing. */
const MAX_ADVANCE = 0.25;
/** How quickly (per second) the share of the cycle that comes from walking follows it. */
const STRIDING_RATE = 6;
/** Texels across the white square of the atlas. */
const WHITE_TEXELS = 2;
/** How far (cells) a creature that starts where it cannot live is moved to where it can. */
const SETTLE_REACH = 48;
/** On the map a creature is a dot (`creatures/markers.ts`) with this dark edge. */
const MARKER_EDGE = 0x1b1b1b;
/** Toward the light: up and to the left. */
const LIGHT = Math.SQRT1_2;
/**
 * Flippers row: so many strokes to a body length travelled, swinging this far (radians)
 * either side of where they rest, which is a little behind straight out to the side.
 */
const STROKES_PER_LENGTH = 1.1;
const STROKE_SWING = 0.55;
const FLIPPER_REST = 0.3;
/** Where along its length a flipper is joined to the body. */
const FLIPPER_ROOT = 0.12;
/**
 * A webbed foot: how far past the end of the leg its middle is, in foot radii, and how
 * long (the way the shin points) and wide it is against a round foot.
 */
const WEB_AHEAD = 0.5;
const WEB_LONG = 0.9;
const WEB_WIDE = 1.2;

/** How a layer's creatures are shown: as bodies, as dots on the map, or not at all. */
export type Showing = "bodies" | "markers" | "hidden";

/**
 * How they move: `wander` roams freely (the benchmark, which has no sim behind it);
 * `anchored` keeps each near the place the sim gives it (`anchor`), with life of its own
 * between sim ticks (`motion.ts`).
 */
export type Life = "wander" | "anchored";
/** A glint in an eye: it keeps more of itself under water. */
const GLINT = 0xffffff;
/** A torpid animal breathes this many times slower. */
const TORPID_BREATH = 3;
/** At a full breath the chest is this much wider. */
const BREATH_WIDENS = 0.08;

interface Leg {
  plan: LegPlan;
  foot: Point;
  target: Point;
  /** The two bones of a leg; a flipper is one blade, in `upper`. */
  upper: Sprite;
  lower: Sprite | null;
  /** The dark edge round the two bones and the foot, on legs thick enough for one. */
  edges: Sprite[];
  /** The foot at the end of the leg, on legs thick enough to show one. */
  sole: Sprite | null;
  /** The foot is webbed: a paddle set across the way the leg points. */
  webbed: boolean;
  /** Its foot has been put down once; until then it is put where it rests, not swung there. */
  planted: boolean;
  /** Where in the gait cycle its swing starts (0 to 1). */
  phase: number;
  /** The foot is in the air, swinging from `lift` to `target`. */
  swinging: boolean;
  lift: Point;
}

interface Creature {
  plan: BodyPlan;
  /** Its species (the sim's id; one drawn by colour when it has none yet), for the packs. */
  species: number;
  /** Not grown yet, and a mother (tending a brood or trailed by a young one): for the nests. */
  young: boolean;
  nurturing: boolean;
  /** What the packs keep of it between passes (`creatures/pack.ts`). */
  pack: PackState;
  container: Container;
  marker: Container;
  joints: Point[];
  /** How far its body bends at each joint, and its head from its body. */
  stiffness: Stiffness;
  heading: number;
  turn: number;
  avoid: 1 | -1;
  /** How far through a stroke its flippers are, in radians. */
  stroke: number;
  /** How far through its gait cycle its legs are (0 to 1), and the cells walked to one cycle. */
  gait: number;
  stride: number;
  /** Cells walked since its legs were last placed. */
  walked: number;
  /** The share of the gait cycle's advance that comes from walking (smoothed), not settling. */
  striding: number;
  /** A foot is in the air or out of its place, so the legs step even standing still. */
  unsettled: boolean;
  /** Where it may go, if it is kept somewhere. */
  pen: CreatureSeed["pen"];
  /** One sprite per part of the plan, in the same order. */
  sprites: Sprite[];
  /** Its Santa hat (the Christmas mod), over its head; shown only while the mod is on. */
  hat: Container;
  legs: Leg[];
  /** Within the view of the last update, so worth drawing. */
  inView: boolean;
  /** Seconds not yet lived out of sight (`OUT_OF_SIGHT_EVERY`). */
  lag: number;
  /** Seconds not yet posed (`POSE_SKIP_EVERY`). */
  poseLag: number;
  /** What it was last posed from (`posedAsBefore`); null before its first pose. */
  posed: Float64Array | null;
  /** The plant over it as last asked (`overOf`), and what that was asked from. */
  over: {
    occluders: Occluders;
    changes: number;
    highest: number;
    lowest: number;
    joints: Float64Array;
    answer: number;
  } | null;
  /** With anchored life: where the sim has it and what it is doing there. */
  motion: Motion | null;
  /** Its mass, which sets how slowly it breathes. */
  mass: number;
  /** Lying torpid: curled up, still, breathing slowly. */
  torpid: boolean;
  /** Held where `pin` put it (debugging the look: an animal placed by hand), not moving. */
  pinned?: boolean;
  /** Put or sent by hand (`pin`, `send`): the sim's places for it are ignored from then on. */
  staged?: boolean;
  /** What it ate in the sim's last tick (R5): it stands and eats while it is not walking. */
  food: Food;
  /** The phase of its last bite, to know when a fleck is thrown. */
  bitePhase: number;
  /** Every sprite of the body with its colour and opacity out of water. */
  paints: { sprite: Sprite; colour: number; alpha: number }[];
  /** The water it was last coloured for (`seaKey`), -1 for none. */
  seaKey: number;
  /** A walker in the water (R5, `creatures/wading.ts`): how hard it is for it (0–1). */
  effort: number;
  /** Whether the water holds it, and how fast it goes there against on land. */
  wet: Wet;
  waterPace: number;
  /** The rings that spread from it in the water, made the first time it wades. */
  ripples: Sprite[] | null;
  /** Its legs' sprites and the joint each of its parts rides, made the first time it wades. */
  legSprites: Set<Sprite> | null;
  /** Glass: what draws the body see-through, once it needs one. */
  glass?: AlphaFilter;
  /** The joint at its widest, which breathes; and how far into a breath it started. */
  chest: number;
  breathOffset: number;
  /** Arriving (R4, the ark): seconds into its arrival and how long it takes, while it lasts. */
  arriving?: { age: number; lasts: number };
  /** Hunting (R5, `hunting.ts`): running to its prey, then springing at it. */
  hunt?: Hunt;
  /** A newborn kept still beside its mother for its birth (R5, `nursery.ts`): seconds left. */
  held?: number;
  /**
   * A mother standing over her newborn (R5): where the first of the brood lies, seconds
   * since, how long, and where each of the brood lies.
   */
  tending?: { x: number; y: number; age: number; lasts: number; brood: Point[] };
  /** Where the sim put it while a hunt or a birth held it, to go to once it is over. */
  deferred?: Point;
  /** Young, the slot of the one it trails (R5, `family.ts`): its mother or an elder of its brood. */
  leader?: number;
  /**
   * Turned to its mate before a birth (R5, `family.ts`): the mate's slot, seconds since,
   * when their heads begin to touch and how long it all lasts; for the mother, the side of
   * her head (1 or -1, as angles turn) the mate stands on, where her young are not put.
   */
  court?: { with: number; age: number; touch: number; lasts: number; side: number };
  /** Its sleep at night (R5, `creatures/sleep.ts`). */
  sleep: Sleeper;
  /** Hurrying to where the sim has it (R5): its feet kick up dust. */
  hurried: boolean;
  /** Out in the rain, shaking it off, hunched in a thunderstorm (R5, `weather.ts`). */
  drench: Drench;
  /**
   * Its rare genes in action (R5): it basks in the sun (photosynthesis, "leaves"), its
   * strike is venomous ("venom"), it leaves a wake swimming (a swimmer, or "gills").
   */
  basks: boolean;
  venomous: boolean;
  wakes: boolean;
  /** Its basking (`basking.ts`), and whether its parts were last drawn spread out. */
  basker: Basker;
  spread: boolean;
  /** Where its head was last frame, and the cells swum since its wake's last dashes. */
  swamFrom: Point;
  swum: number;
}

/** An eating animal's neck goes this share of the way its head does. */
const NECK_FOLLOWS = 0.5;
/** A fleck from an eating animal's mouth is this many art pixels across. */
const FLECK_PIXELS = 3;
/** The young of one brood lie at least this many of their widest radii apart beside their mother. */
const BROOD_APART = 2.2;
/** Drops shaken off a wet animal are this many art pixels across. */
const DROP_PIXELS = 1;
/** A hunter's dust: puffs this many art pixels across, each this many body spacings behind the last. */
const DUST_PIXELS = 5;
const KICK_BACK = 0.6;
/** An eating animal's pause is kept at least this long (seconds), so it does not stroll off. */
const EAT_HOLD_S = 1;
/** Ripples round a walker in the water: the foam's white. */
const RIPPLE_TINT = 0xf4fbff;
/** The most foam dashes of swimmers' wakes out at once (R5, `wake.ts`). */
const WAKE_MARKS = 192;
/**
 * What the plants answer about where they stand (R5, `PlantLayer.over`): the row of the
 * first (backmost) tree or bush whose drawing overlaps `box`, among those whose foot lies
 * from as far behind row `from` to as far in front of row `to` as a plant's drawing
 * reaches; -1 if none. A bush drawn in pieces asks which of the animal's `joints` (with
 * `radii`) are behind each piece.
 */
export interface Occluders {
  /**
   * Bumped whenever what `over` answers could change for the same question: plants built,
   * a piece of a bush slid in the wind (a cache of answers is good while it stays).
   */
  readonly changes?: number;
  over(
    box: CellRect,
    from: number,
    to: number,
    joints?: readonly Point[],
    radii?: readonly number[],
  ): number;
}

/**
 * The Santa hat of the Christmas mod (`mods/builtin/christmas.ts`), in head radii: the red
 * cone's width at the brim and its height, how far it leans, the white brim's width and
 * depth, the pom-pom across, and how far above the head's middle the brim sits.
 */
const HAT_RED = 0xd32f2f;
const HAT_WHITE = 0xffffff;
const HAT_WIDE = 1.3;
const HAT_TALL = 1.5;
const HAT_LEAN = 0.3;
const HAT_BRIM_WIDE = 1.5;
const HAT_BRIM_DEEP = 0.35;
const HAT_POM = 0.5;
const HAT_ABOVE = 0.75;

/** Steps of opacity an arriving creature comes into being in (and a dead one fades in). */
const ARRIVE_STEPS = 4;
/** A creature that died, going where it fell (`remove`). */
interface Departing {
  creature: Creature;
  how: Dying;
  /** Seconds since it died. */
  age: number;
  /** Its sprites in the order they go: legs first, then from the tail to the head. */
  order: Sprite[];
  /** How many of `order` are gone, and the colour step it was last painted at. */
  gone: number;
  tinted: number;
  /** Seconds it still stands as it was before it begins to go (R5: a prey until the strike). */
  wait: number;
}

export class CreatureLayer {
  /** Whether the swash covers the beach at a place now (R5, wet feet); none, never. */
  swash: ((x: number, y: number) => boolean) | null = null;
  /** Creatures not standing among plants, and every marker. Add this to the world. */
  readonly container = new Container();
  /** Flecks thrown by eating animals (R5), over them; made with the first animal placed. */
  private flecks: Flecks | null = null;
  /** The dust a hunter kicks up as it springs (R5), over the animals; made with the first. */
  private dust: Flecks | null = null;
  /** The hearts, eggs and shells of births (R5), over the animals; made with the first. */
  private nursery: Nursery | null = null;
  /**
   * The glints of basking and the marks of venom (R5), made with the first: over the
   * animals and what deaths leave (a kill's scuffle), in `over`.
   */
  private sparks: Sparks | null = null;
  readonly over = new Container();
  /**
   * What lies on the water under the animals (R5: the swimmers' wakes): add it to the
   * scene's floor (`Landscape.floor`), under the plants and the animals.
   */
  readonly floor = new Container();
  private foam: Sparks | null = null;
  /**
   * The packs (the Packs and Rivals mod): seconds since they were last
   * looked at, the nests drawn on the floor (made as colonies come), and how the layer
   * answers the packs' questions (made once).
   */
  private packLag = 0;
  private readonly nests: Sprite[] = [];
  private readonly packHooks: PackHooks<Creature> = {
    idle: (creature) => this.steerable(creature),
    free: (creature, x, y) => this.clear(creature, x, y),
    skirmish: (x, y) => {
      this.skirmish(x, y);
    },
  };
  /** How overcast the sky is (0–1, R4's): no animal basks under cloud. */
  private overcast = 0;
  /** Creatures that died, going where they fell. */
  private departing: Departing[] = [];
  /** By slot; a slot the stream's cast has emptied (`remove`) is undefined. */
  private readonly creatures: (Creature | undefined)[] = [];
  private active = 0;
  private only: number | null = null;
  private showing: Showing = "bodies";
  // Scratch, reused every frame so the animation allocates nothing.
  private readonly hip: Point = { x: 0, y: 0 };
  /**
   * The animal `live` moves, its walker, and the ways it asks where it may go: made once
   * and filled for each animal (R5, the board: an object and two closures per animal per
   * frame were much of what the collector had to clear).
   */
  private living: Creature | null = null;
  /** What an animal is posed from now (`posedAsBefore`): its joints (at most 16) and seven more. */
  private readonly posedNow = new Float64Array(16 * 2 + 7);
  private readonly walker: Walker = { head: { x: 0, y: 0 }, heading: 0, pace: 0, length: 0 };
  private readonly livingGround = (x: number, y: number): boolean =>
    this.passable(x, y, this.living?.plan.swims ?? false);
  private readonly livingFree = (x: number, y: number): boolean =>
    this.living === null ? true : this.clear(this.living, x, y);
  private readonly knee: Point = { x: 0, y: 0 };
  private readonly foot: Point = { x: 0, y: 0 };
  /** Where a young one trails its mother, worked out each frame (`family`). */
  private readonly trailAt: Point = { x: 0, y: 0 };
  private readonly dirX = new Float32Array(16);
  private readonly dirY = new Float32Array(16);
  private readonly angle = new Float32Array(16);
  /** Seconds since the layer began: the clock breaths keep. */
  private clock = 0;
  /** Updates since the layer began: which animals out of sight live this one. */
  private ticks = 0;
  /** Animals in sight posed on two updates in three (`POSE_SKIP_EVERY`): the middle view's. */
  posedSparsely = false;
  /** The trees and bushes anchored animals keep clear of (R5), if any. */
  private footprints: Footprints | null = null;
  /** The night the animals sleep in (R5, `sleep.ts`). */
  private night: Night = { depth: 0, rising: false };
  /** Shown again after a time hidden: who sleeps is lying down at once, not settling now. */
  private fresh = true;
  /** Told where a foot of an animal hurrying on dry land comes down (R5: a puff of dust). */
  footfall: ((x: number, y: number) => void) | null = null;
  /** What falls from the sky now and what fell last frame (R5, `weather.ts`). */
  private falling: Downpour = "dry";
  private fell: Downpour = "dry";
  /** The drops shaken off wet animals (R5); made the first time one shakes in sight. */
  private spray: Spray | null = null;
  /** Each joint's place before a shake or a hunch moved it for the drawing (scratch). */
  private readonly heldX = new Float32Array(16);
  private readonly heldY = new Float32Array(16);

  constructor(
    private readonly atlas: Atlas,
    private readonly seeds: readonly CreatureSeed[],
    private readonly passable: Passable,
    private readonly random: Random,
    private readonly body: BodyOptions = FIRST_LOOK,
    private readonly life: Life = "wander",
    /** The water at a place: swimmers are coloured as seen through it. */
    private readonly sea: SeaAt | null = null,
    /** How they are seen through it. */
    private readonly water: WaterLook = "hue",
  ) {
    this.plans = speciesPlans(seeds);
  }

  /** What each species among the seeds is drawn as (one plan per species). */
  private plans: ReadonlyMap<number, SpeciesPlan>;

  /**
   * Draw the species among `members` by their plans from now on (the census changed):
   * animals placed after this take their species' kind from them; those drawn keep theirs.
   */
  replan(members: readonly CreatureSeed[]): void {
    this.plans = speciesPlans(members);
  }

  /** What each species is drawn as now (R5: the name card's portrait draws its animal so). */
  get speciesPlans(): ReadonlyMap<number, SpeciesPlan> {
    return this.plans;
  }

  /** Draw the species by `plans` from now on (R5: a portrait takes the scene's own). */
  usePlans(plans: ReadonlyMap<number, SpeciesPlan>): void {
    this.plans = plans;
  }

  /**
   * Put `seed` in slot `index`, in place of whoever was there: a creature of the stream's
   * cast (R3), which comes and goes as the sim's animals are born and die. With anchored
   * life it then lives near the place `seed` gives until `anchor` moves it.
   */
  place(index: number, seed: CreatureSeed): void {
    this.remove(index);
    const creature = this.spawnFrom(seed, false);
    this.creatures[index] = creature;
    this.active = Math.max(this.active, index + 1);
    this.reveal(creature, index);
  }

  /**
   * Draw slot `index`'s creature again from `seed` where it is, going on as it was (R5:
   * its colours change when the species alive do, a young one grows): the same place,
   * heading and motion, a new body.
   */
  rebuild(index: number, seed: CreatureSeed): void {
    const old = this.creatures[index];
    if (old === undefined) {
      this.place(index, seed);
      return;
    }
    const creature = this.spawnFrom(seed, false);
    const head = old.joints[0] ?? { x: seed.x, y: seed.y };
    creature.joints.forEach((joint, i) => {
      joint.x = head.x - Math.cos(old.heading) * creature.plan.spacing * i;
      joint.y = head.y - Math.sin(old.heading) * creature.plan.spacing * i;
    });
    if (seed.torpid) curl(creature.joints, creature.plan.spacing, old.heading);
    creature.heading = old.heading;
    creature.turn = old.turn;
    creature.avoid = old.avoid;
    creature.motion = old.motion;
    creature.inView = old.inView;
    if (old.arriving !== undefined) creature.arriving = old.arriving;
    // A hunt or a birth under way goes on.
    if (old.hunt !== undefined) creature.hunt = old.hunt;
    if (old.held !== undefined) creature.held = old.held;
    if (old.tending !== undefined) creature.tending = old.tending;
    if (old.deferred !== undefined) creature.deferred = old.deferred;
    if (old.leader !== undefined) creature.leader = old.leader;
    if (old.court !== undefined) creature.court = old.court;
    // Staged by hand, it stays as it was put (R5: else the sim's place took it away).
    if (old.pinned !== undefined) creature.pinned = old.pinned;
    if (old.staged !== undefined) creature.staged = old.staged;
    // Basking it basks on (R5); its wake goes on from where it was.
    creature.basker = old.basker;
    creature.swamFrom = old.swamFrom;
    creature.swum = old.swum;
    // Asleep it sleeps on, lying as it lay (R5).
    carrySleep(creature.sleep, old.sleep);
    creature.drench = old.drench;
    // A face-off under way goes on (the packs, `creatures/pack.ts`).
    creature.pack = old.pack;
    if (old.sleep.share > 0 && old.joints.length === creature.joints.length) {
      creature.joints.forEach((joint, i) => {
        joint.x = old.joints[i]?.x ?? joint.x;
        joint.y = old.joints[i]?.y ?? joint.y;
      });
    }
    // Where the old one stood among the plants, the new one stands.
    const host = old.container.parent;
    if (host !== null && host !== creature.container.parent) {
      host.addChildAt(creature.container, host.getChildIndex(old.container));
    }
    creature.container.visible = old.container.visible;
    creature.marker.visible = old.marker.visible;
    creature.container.alpha = old.container.alpha;
    creature.marker.alpha = old.marker.alpha;
    this.creatures[index] = creature;
    this.destroy(old);
  }

  /**
   * Empty slot `index`: its creature is taken off the screen for good, at once, or (one
   * that died, `fade`) going where it fell, as `how` says (`creatures/remains.ts`): it lies
   * still, its colours turning, then its parts go in steps, legs first, then from the tail
   * to the head. No filter: whole sprites go, so nothing shows through anything. With
   * `waitS` it first stands as it was for so many seconds (R5: a prey until the strike).
   */
  remove(index: number, fade = false, how: Dying = DYING.unknown, waitS = 0): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    this.creatures[index] = undefined;
    if (fade && (creature.container.visible || creature.marker.visible)) {
      const legs = new Set(
        creature.legs.flatMap((leg) => [
          leg.upper,
          ...(leg.lower === null ? [] : [leg.lower]),
          ...leg.edges,
          ...(leg.sole === null ? [] : [leg.sole]),
        ]),
      );
      const parts = creature.plan.parts;
      const body = creature.sprites
        .map((sprite, i) => ({ sprite, joint: parts[i]?.joint ?? 0 }))
        .sort((a, b) => b.joint - a.joint)
        .map(({ sprite }) => sprite);
      // What is not of the body (ripples, a shadow) goes at once, and a sunk body's legs.
      for (const ring of creature.ripples ?? []) ring.visible = false;
      creature.hat.visible = false;
      for (const { sprite, alpha } of creature.paints) if (alpha < 1) sprite.visible = false;
      if (how.sinks) for (const sprite of legs) sprite.visible = false;
      this.departing.push({
        creature,
        how,
        age: 0,
        order: [...legs, ...body],
        gone: 0,
        tinted: 0,
        wait: waitS,
      });
      return;
    }
    this.destroy(creature);
  }

  private destroy(creature: Creature): void {
    creature.container.destroy({ children: true });
    creature.marker.destroy({ children: true });
    creature.glass?.destroy();
  }

  /** The dead going where they fell, step by step, until they are gone. */
  private depart(dtS: number): void {
    // Kept in place, so that a frame makes no new list.
    let kept = 0;
    for (const leaving of this.departing) {
      if (this.going(leaving, dtS)) this.departing[kept++] = leaving;
    }
    this.departing.length = kept;
  }

  /** Move `leaving` on by `dtS`: whether it is still there. */
  private going(leaving: Departing, dtS: number): boolean {
    if (leaving.wait > 0) {
      leaving.wait -= dtS;
      return true;
    }
    leaving.age += dtS;
    const { creature, how, order } = leaving;
    const lasts = how.still + how.goes;
    if (leaving.age >= lasts) {
      this.destroy(creature);
      return false;
    }
    // Its colours turn while it lies still, in a few steps.
    const step = Math.min(
      Math.floor((leaving.age / Math.max(how.still, 0.01)) * TINT_STEPS) + 1,
      TINT_STEPS,
    );
    if (how.tinted > 0 && step !== leaving.tinted) {
      leaving.tinted = step;
      const share = (how.tinted * step) / TINT_STEPS;
      for (const { sprite, colour, alpha } of creature.paints) {
        if (alpha >= 1) sprite.tint = mixColour(colour, how.tint, share);
      }
    }
    // Then its parts go, legs first, then from the tail to the head.
    const share = Math.max(leaving.age - how.still, 0) / Math.max(how.goes, 0.01);
    const gone = Math.min(Math.floor(share * (order.length + 1)), order.length);
    for (; leaving.gone < gone; leaving.gone++) {
      const sprite = order[leaving.gone];
      if (sprite !== undefined) sprite.visible = false;
    }
    // On the map its dot fades in steps.
    creature.marker.alpha =
      Math.ceil((1 - leaving.age / lasts) * ARRIVE_STEPS) / (ARRIVE_STEPS + 1);
    return true;
  }

  /**
   * The creature in slot `index` arrives (R4, the ark's newcomers): it comes into being
   * over `seconds`, see-through at first, in a few steps as pixel art does.
   */
  arrive(index: number, seconds: number): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    creature.arriving = { age: 0, lasts: seconds };
    this.materialise(creature);
  }

  private materialise(creature: Creature): void {
    const arriving = creature.arriving;
    if (arriving === undefined) return;
    const done = arriving.age >= arriving.lasts;
    // Not yet begun (R5: a newborn still in its egg), it is not seen at all.
    const opacity = done
      ? 1
      : arriving.age < 0
        ? 0
        : (Math.floor((arriving.age / arriving.lasts) * ARRIVE_STEPS) + 1) / (ARRIVE_STEPS + 1);
    creature.marker.alpha = opacity;
    if (done) {
      creature.arriving = undefined;
      creature.container.filters = [];
      creature.seaKey = -2; // colour it for the water it is in again
      return;
    }
    creature.glass ??= new AlphaFilter();
    creature.glass.alpha = opacity;
    creature.container.filters = [creature.glass];
  }

  /** Whether slot `index`'s animal is venomous (R5: its kill's scuffle puffs green). */
  venomous(index: number): boolean {
    return this.creatures[index]?.venomous === true;
  }

  /**
   * Whether slot `index`'s animal is in a fight: facing a rival or backing away from one
   * (the packs' face-offs, `pack.ts`), or running down its prey (`hunting.ts`).
   */
  fighting(index: number): boolean {
    const creature = this.creatures[index];
    if (creature === undefined) return false;
    return creature.pack.stare > 0 || creature.pack.retreats || creature.hunt !== undefined;
  }

  /** Whether slot `index` holds a creature. */
  has(index: number): boolean {
    return this.creatures[index] !== undefined;
  }

  /** Creature `index` lies torpid (curled up, still) or wakes. */
  /** Slot `index`'s animal is eating `food` (R5), as the sim's last tick has it. */
  setFood(index: number, food: Food, staged = false): void {
    const creature = this.creatures[index];
    if (creature === undefined || (creature.staged === true && !staged)) return;
    creature.food = food;
  }

  /**
   * The animal in slot `hunterIndex` hunts the one in `preyIndex` (R5, `hunting.ts`): it
   * runs to where the prey stands and springs at it. Returns the seconds until the strike,
   * when the prey is to die; null if it does not hunt here (bodies not shown, the hunter
   * torpid, arriving, busy, staged by hand unless `byHand`, or too far away).
   */
  hunt(hunterIndex: number, preyIndex: number, byHand = false): number | null {
    const hunter = this.creatures[hunterIndex];
    const prey = this.creatures[preyIndex];
    const head = hunter?.joints[0];
    const motion = hunter?.motion;
    if (hunter === undefined || prey === undefined || head === undefined || !motion) return null;
    if (this.showing !== "bodies" || hunter.torpid || hunter.arriving !== undefined) return null;
    if (hunter.hunt !== undefined || hunter.held !== undefined || hunter.tending !== undefined) {
      return null;
    }
    if (hunter.staged === true && !byHand) return null;
    // It strikes at the prey's joint nearest it.
    let nearest = 0;
    let best = Infinity;
    prey.joints.forEach((joint, i) => {
      const distance = Math.hypot(joint.x - head.x, joint.y - head.y);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    const at = prey.joints[nearest] ?? { x: head.x, y: head.y };
    const reach = prey.plan.radii[nearest] ?? 0;
    const spring = SPRING_SHARE * hunter.plan.length + reach;
    const run = chase(Math.max(best - spring, 0), hunter.plan.pace);
    if (run === null) return null;
    // It runs to a place short of the prey, on the way to it; where the sim has it, it
    // goes once the hunt is over.
    const share = best > spring ? (best - spring) / best : 0;
    hunter.deferred ??= { x: motion.anchor.x, y: motion.anchor.y };
    if (hunter.staged === true) hunter.deferred = undefined;
    hunter.pinned = false;
    motion.anchor.x = head.x + (at.x - head.x) * share;
    motion.anchor.y = head.y + (at.y - head.y) * share;
    motion.goal.x = motion.anchor.x;
    motion.goal.y = motion.anchor.y;
    motion.mode = "travel";
    hunter.hunt = {
      prey: { x: at.x, y: at.y },
      reach,
      age: 0,
      run: run.run,
      speed: run.speed,
      from: null,
    };
    return strikeAfter(run.run);
  }

  /**
   * The animal in slot `childIndex` is born to the one in `motherIndex` (R5, `nursery.ts`):
   * it comes into being beside her head, facing her, out of an egg if `egg` (on dry land),
   * and she stands over it a while, hearts rising. False if it is not shown so (bodies not
   * shown; she is torpid, arriving, busy, or staged by hand unless `byHand`; no room by
   * her): the newborn is then left where it was placed. Before the first of a brood, she
   * and the nearest of `mates` (slots of grown ones of her kind) touch heads, if one is
   * near (`family.ts`).
   */
  nurse(
    childIndex: number,
    motherIndex: number,
    egg: boolean,
    byHand = false,
    mates: readonly number[] = [],
  ): boolean {
    const child = this.creatures[childIndex];
    const mother = this.creatures[motherIndex];
    const head = mother?.joints[0];
    if (child === undefined || mother === undefined || head === undefined) return false;
    if (child.motion === null || mother.motion === null || this.showing !== "bodies") return false;
    if (mother.torpid || mother.arriving !== undefined || mother.hunt !== undefined) return false;
    if (mother.held !== undefined || child === mother) return false;
    // The rest of a brood born together lie beside the first; a later one is not shown so.
    const brood = mother.tending?.brood;
    if (mother.tending !== undefined && mother.tending.age > 0) return false;
    if (mother.staged === true && !byHand) return false;
    // Its head by hers, its body away from her, where there is room for it all.
    const away = (mother.plan.radii[0] ?? 0) + (child.plan.radii[0] ?? 0) + BESIDE_GAP;
    const tail = child.plan.spacing * (child.joints.length - 1);
    let spot: Point | null = null;
    let angle = 0;
    for (const turn of BESIDE_ANGLES) {
      // Not where her mate stands (R5, `family.ts`).
      if ((mother.court?.side ?? 0) * turn > 0) continue;
      const a = mother.heading + turn;
      const x = head.x + Math.cos(a) * away;
      const y = head.y + Math.sin(a) * away;
      if (!this.clear(child, x, y)) continue;
      if (!this.clear(child, x + Math.cos(a) * tail, y + Math.sin(a) * tail)) continue;
      const room = BROOD_APART * Math.max(...child.plan.radii);
      if (brood?.some((at) => Math.hypot(at.x - x, at.y - y) < room) === true) continue;
      spot = { x, y };
      angle = a;
      break;
    }
    if (spot === null) return false;
    const { x, y } = spot;
    child.heading = angle + Math.PI;
    child.joints.forEach((joint, i) => {
      joint.x = x + Math.cos(angle) * child.plan.spacing * i;
      joint.y = y + Math.sin(angle) * child.plan.spacing * i;
    });
    for (const leg of child.legs) leg.planted = false;
    child.motion.anchor.x = x;
    child.motion.anchor.y = y;
    child.motion.mode = "pause";
    child.motion.timer = 0;
    child.motion.look = child.heading;
    child.motion.facing = child.heading;
    child.marker.position.set(x, y);
    if (byHand) child.staged = true;
    const laid = egg && !child.plan.swims && (this.sea?.(x, y) ?? null) === null;
    const moment = (laid ? EGG_S : 0) + MOMENT_S;
    // First she and her mate touch heads, if one is near; the rest of a brood wait as long.
    const court =
      brood === undefined
        ? this.court(motherIndex, mates, angle - mother.heading, byHand)
        : Math.max(0, -(mother.tending?.age ?? 0));
    child.held = moment + court;
    child.arriving = { age: (laid ? -EGG_S : 0) - court, lasts: laid ? HATCH_S : NEWBORN_S };
    this.materialise(child);
    const nursery = this.nurseryPool();
    // The egg lies where its body will.
    const middle = child.joints[child.chest] ?? spot;
    if (laid) nursery.lay(middle, child.plan.length, court);
    if (brood !== undefined) {
      brood.push(spot);
      return true;
    }
    mother.tending = { x, y, age: -court, lasts: moment, brood: [spot] };
    nursery.love({ x: (head.x + x) / 2, y: (head.y + y) / 2 }, court + (laid ? EGG_S : NEWBORN_S));
    return true;
  }

  /**
   * The mother in `motherIndex` and the nearest of `mates` to her head turn to each other
   * and touch heads before her newborn is there (R5, `family.ts`): the mate walks up to one
   * side of her head, the side away from `away` (radians from the way she faces, where the
   * newborn will lie). Returns the seconds it takes, 0 if no mate is near or free.
   */
  private court(
    motherIndex: number,
    mates: readonly number[],
    away: number,
    byHand: boolean,
  ): number {
    const mother = this.creatures[motherIndex];
    const head = mother?.joints[0];
    if (mother === undefined || head === undefined) return 0;
    let mate: Creature | undefined;
    let mateIndex = -1;
    let nearest = COURT_REACH_CELLS;
    let walk = 0;
    for (const index of mates) {
      const other = this.creatures[index];
      const at = other?.joints[0];
      if (other === undefined || at === undefined || other === mother || other.motion === null)
        continue;
      if (other.torpid || other.sleep.share > 0 || other.arriving !== undefined) continue;
      if (other.hunt !== undefined || other.held !== undefined || other.tending !== undefined)
        continue;
      if (other.court !== undefined || (other.staged === true && !byHand)) continue;
      const far = Math.hypot(at.x - head.x, at.y - head.y);
      // Only one that can walk up to her soon.
      const ahead = Math.max(0, far - (mother.plan.radii[0] ?? 0) - (other.plan.radii[0] ?? 0));
      const seconds =
        other.pinned === true
          ? 0
          : (COURT_WALK_MARGIN * ahead) /
            Math.max(COURT_TROT * other.plan.pace * other.waterPace, 1e-3);
      if (far < nearest && seconds <= COURT_WALK_MOST_S) {
        nearest = far;
        mate = other;
        mateIndex = index;
        walk = Math.max(COURT_WALK_LEAST_S, seconds);
      }
    }
    const motion = mate?.motion;
    const at = mate?.joints[0];
    if (mate === undefined || motion == null || at === undefined) return 0;
    // The side away from her newborn; with it straight ahead, the side the mate is on.
    const across =
      Math.cos(mother.heading) * (at.y - head.y) - Math.sin(mother.heading) * (at.x - head.x);
    const side = Math.abs(away) > 1e-3 ? -Math.sign(away) : across < 0 ? -1 : 1;
    const gap = (mother.plan.radii[0] ?? 0) + (mate.plan.radii[0] ?? 0) + COURT_GAP_CELLS;
    for (const turn of mate.pinned === true ? [0] : COURT_ANGLES) {
      const a = mother.heading + side * turn;
      const x = mate.pinned === true ? at.x : head.x + Math.cos(a) * gap;
      const y = mate.pinned === true ? at.y : head.y + Math.sin(a) * gap;
      // One held by hand leans from where it stands; the others walk up.
      if (mate.pinned !== true) {
        if (!this.clear(mate, x, y)) continue;
        mate.deferred ??= { x: motion.anchor.x, y: motion.anchor.y };
        motion.anchor.x = x;
        motion.anchor.y = y;
        motion.goal.x = x;
        motion.goal.y = y;
        motion.mode = "travel";
      }
      const lasts = walk + COURT_TOUCH_S;
      mate.court = { with: motherIndex, age: 0, touch: walk, lasts, side: 0 };
      mother.court = { with: mateIndex, age: 0, touch: walk, lasts, side };
      if (isDramaticDirectorActive()) {
        dramaticDirector.recordCourtship(0, 0, (head.x + x) / 2, (head.y + y) / 2);
      }
      this.nurseryPool().love(
        { x: (head.x + x) / 2, y: (head.y + y) / 2 },
        walk + COURT_TOUCH_S * COURT_HEARTS_FROM,
        COURT_HEARTS,
      );
      return lasts;
    }
    return 0;
  }

  /** The flecks of the layer, made the first time they are needed. */
  private fleckPool(): Flecks {
    if (this.flecks === null) {
      this.flecks = new Flecks(this.atlas.white, FLECK_PIXELS / this.body.pixels, WHITE_TEXELS);
      this.container.addChild(this.flecks.container);
    }
    return this.flecks;
  }

  /** The births' hearts and eggs of the layer, made the first time they are needed. */
  private nurseryPool(): Nursery {
    if (this.nursery === null) {
      this.nursery = new Nursery(this.body.pixels);
      this.container.addChild(this.nursery.container);
    }
    return this.nursery;
  }

  /**
   * A hunter on its hunt (R5): it runs to its place short of the prey (`live`, quicker),
   * crouching there facing it if early; then it springs, its head going straight at the
   * prey quicker and quicker, its body after it, and dust kicked up behind.
   */
  private chase(creature: Creature, hunt: Hunt, dtS: number): Point {
    const { joints, plan, motion } = creature;
    const head = joints[0] ?? { x: 0, y: 0 };
    hunt.age += dtS;
    if (hunt.age < hunt.run) {
      this.live(creature, dtS);
      if (motion !== null && motion.mode === "pause") {
        const toward = Math.atan2(hunt.prey.y - head.y, hunt.prey.x - head.x);
        motion.timer = Math.max(motion.timer, hunt.run - hunt.age);
        motion.look = toward;
        motion.facing = toward;
      }
      return head;
    }
    if (hunt.from === null) {
      hunt.from = { x: head.x, y: head.y };
      this.kick(creature);
    }
    const { travel } = lunge(Math.min((hunt.age - hunt.run) / LUNGE_S, 1));
    const dx = hunt.prey.x - hunt.from.x;
    const dy = hunt.prey.y - hunt.from.y;
    const span = Math.hypot(dx, dy) || 1;
    // The head goes until it is in the prey's body by part of its own radius.
    const stop = hunt.reach + (1 - BITE_INTO) * (plan.radii[0] ?? 0);
    const go = Math.max(span - stop, 0) * travel;
    const x = hunt.from.x + (dx / span) * go;
    const y = hunt.from.y + (dy / span) * go;
    creature.walked += Math.hypot(x - head.x, y - head.y);
    head.x = x;
    head.y = y;
    creature.heading = Math.atan2(dy, dx);
    followChain(joints, plan.spacing, creature.stiffness, creature.heading, dtS);
    creature.marker.position.set(head.x, head.y);
    // A venomous hunter's bite (R5, `venom.ts`): at the strike, where its head is thrust.
    const strike = strikeAfter(hunt.run);
    if (creature.venomous && creature.inView && hunt.age >= strike && hunt.age - dtS < strike) {
      const thrust = LUNGE_STRETCH * plan.spacing;
      const bite = {
        x: head.x + Math.cos(creature.heading) * thrust,
        y: head.y + Math.sin(creature.heading) * thrust,
      };
      envenom(this.sparkPool(), bite, hunt.prey, dx < 0 ? -1 : 1, this.body.pixels);
    }
    return head;
  }

  /** The glints and the venom's marks of the layer, made the first time they are needed. */
  private sparkPool(): Sparks {
    if (this.sparks === null) {
      this.sparks = new Sparks(this.body.pixels);
      this.over.addChild(this.sparks.container);
    }
    return this.sparks;
  }

  /**
   * A photosynthesiser in the sun (R5, `basking.ts`): standing about on dry land, it
   * settles and spreads out flat (drawn by `pose` and `walk`), and does not stroll off
   * while it basks; a glint runs over its back now and then.
   */
  private sunbathe(creature: Creature, sun: boolean, dtS: number): void {
    const { motion } = creature;
    const wants =
      sun &&
      motion !== null &&
      (creature.pinned === true || motion.mode === "pause") &&
      creature.food === "none" &&
      !creature.torpid &&
      creature.sleep.share === 0 &&
      creature.arriving === undefined &&
      creature.wet === "dry";
    if (wants) {
      motion.timer = Math.max(motion.timer, EAT_HOLD_S);
      motion.look = creature.heading;
      motion.facing = creature.heading;
    }
    bask(creature.basker, wants, dtS);
    if (!creature.inView || !glintDue(creature.basker, dtS, creature.breathOffset)) return;
    // On its back, between its head and its tail, where the light falls on it.
    const { joints, plan } = creature;
    const along = Math.max(joints.length - 2, 1);
    const at = 1 + glintPlace(creature.basker, along, creature.breathOffset);
    const joint = joints[Math.min(at, joints.length - 1)];
    if (joint === undefined) return;
    const lift = (plan.radii[at] ?? 0) * 0.4 * LIGHT;
    this.sparkPool().emit(glintKind(), GLINT_COLOUR, joint.x - lift, joint.y - lift);
  }

  /**
   * A swimmer's wake (R5, `wake.ts`): a pair of foam dashes beside it every few art
   * pixels it swims in the water, none while it stands still or out of the water.
   */
  private wake(creature: Creature, head: Point, dtS: number): void {
    const from = creature.swamFrom;
    const moved = Math.hypot(head.x - from.x, head.y - from.y);
    from.x = head.x;
    from.y = head.y;
    if (dtS <= 0) return;
    const swimming =
      (creature.plan.swims || creature.wet === "shallow" || creature.wet === "deep") &&
      creature.inView &&
      this.showing === "bodies" &&
      creature.arriving === undefined &&
      moved / dtS >= WAKE_FROM &&
      moved < creature.plan.length;
    if (!swimming) {
      creature.swum = 0;
      return;
    }
    creature.swum += moved;
    const every = WAKE_EVERY_PX / this.body.pixels;
    if (creature.swum < every) return;
    creature.swum = Math.min(creature.swum - every, every);
    if (this.foam === null) {
      this.foam = new Sparks(this.body.pixels, WAKE_MARKS);
      this.floor.addChild(this.foam.container);
    }
    const widest = creature.joints[creature.chest] ?? head;
    const radius = creature.plan.radii[creature.chest] ?? 0;
    wakePair(this.foam, widest, creature.heading, radius, this.body.pixels);
  }

  /**
   * Dust kicked up from a hunter's hind feet as it springs (R5), round puffs thrown up
   * behind them (from the end of its body if it has no feet).
   */
  private kick(creature: Creature): void {
    if (!creature.inView) return;
    const { joints, legs, plan } = creature;
    const steppers = legs.filter((leg) => leg.plan.fin < 1);
    const last = Math.max(-1, ...steppers.map((leg) => leg.plan.joint));
    const tail = joints[joints.length - 1];
    const feet: Point[] =
      last >= 0
        ? steppers.filter((leg) => leg.plan.joint === last).map((leg) => leg.foot)
        : tail === undefined
          ? []
          : [tail];
    if (this.dust === null) {
      this.dust = new Flecks(
        roundTexture(DUST_PIXELS),
        DUST_PIXELS / this.body.pixels,
        DUST_PIXELS,
      );
      this.container.addChild(this.dust.container);
    }
    const backX = -Math.cos(creature.heading) * plan.spacing * KICK_BACK;
    const backY = -Math.sin(creature.heading) * plan.spacing * KICK_BACK;
    for (const foot of feet) {
      // One at the foot and one behind it, drifting away from the body's middle.
      const middle = joints[creature.chest] ?? foot;
      const side =
        (foot.x - middle.x) * -Math.sin(creature.heading) +
          (foot.y - middle.y) * Math.cos(creature.heading) <
        0
          ? -1
          : 1;
      for (let k = 0; k < KICKED; k++) {
        this.dust.fling(DUST, { x: foot.x + backX * k, y: foot.y + backY * k }, side);
      }
    }
  }

  /**
   * End what is over of a hunt or a birth, and send the animal on to where the sim has it
   * meanwhile, if it said.
   */
  private endMoments(creature: Creature, index: number, dtS: number): void {
    let ended = false;
    const { hunt, motion } = creature;
    if (hunt !== undefined && hunt.age >= hunt.run + LUNGE_S) {
      creature.hunt = undefined;
      // It stays where it struck.
      const head = creature.joints[0];
      if (motion !== null && head !== undefined) {
        motion.anchor.x = head.x;
        motion.anchor.y = head.y;
        motion.mode = "pause";
        motion.timer = 0;
      }
      ended = true;
    }
    if (creature.held !== undefined) {
      creature.held -= dtS;
      if (creature.held <= 0) {
        creature.held = undefined;
        ended = true;
      }
    }
    if (creature.tending !== undefined) {
      creature.tending.age += dtS;
      if (creature.tending.age >= creature.tending.lasts) {
        creature.tending = undefined;
        ended = true;
      }
    }
    let courted = false;
    if (creature.court !== undefined) {
      creature.court.age += dtS;
      if (creature.court.age >= creature.court.lasts) {
        creature.court = undefined;
        ended = true;
        courted = true;
      }
    }
    const busy =
      creature.hunt !== undefined ||
      creature.held !== undefined ||
      creature.tending !== undefined ||
      creature.court !== undefined;
    if (!ended || busy || creature.deferred === undefined) return;
    const { x, y } = creature.deferred;
    creature.deferred = undefined;
    // A mate staged by hand goes back to where it was put (R5).
    if (courted && creature.staged === true && motion !== null) {
      motion.anchor.x = x;
      motion.anchor.y = y;
      return;
    }
    this.anchor(index, x, y);
  }

  /**
   * Pose a hunter thrusting its head at its prey, or a mother lowering hers to her newborn
   * (R5): the head moved for the drawing only, the neck half as far, as eating does.
   */
  private reach(creature: Creature, head: Point, dtS: number): void {
    const { hunt, tending, court, plan } = creature;
    let dx = 0;
    let dy = 0;
    const mate = court === undefined ? undefined : this.creatures[court.with]?.joints[0];
    if (hunt?.from != null) {
      const { stretch } = lunge(Math.min((hunt.age - hunt.run) / LUNGE_S, 1));
      dx = Math.cos(creature.heading) * LUNGE_STRETCH * plan.spacing * stretch;
      dy = Math.sin(creature.heading) * LUNGE_STRETCH * plan.spacing * stretch;
    } else if (court !== undefined && mate !== undefined && (tending?.age ?? -1) < 0) {
      // Courting (R5): its head goes toward its mate's, closing its share of the gap.
      const other = this.creatures[court.with];
      const tx = mate.x - head.x;
      const ty = mate.y - head.y;
      const distance = Math.hypot(tx, ty) || 1;
      const touching = (plan.radii[0] ?? 0) + (other?.plan.radii[0] ?? 0);
      const lean = courtLean(court.age, court.touch, court.lasts);
      const amount = Math.min(
        Math.max(0, distance - touching) * lean,
        COURT_LEAN_MOST * plan.spacing,
      );
      dx = (tx / distance) * amount;
      dy = (ty / distance) * amount;
    } else if (tending !== undefined && tending.age >= 0) {
      const tx = tending.x - head.x;
      const ty = tending.y - head.y;
      const distance = Math.hypot(tx, ty) || 1;
      const dip = 0.5 - 0.5 * Math.cos((2 * Math.PI * tending.age) / NUZZLE_S);
      const amount = NUZZLE_REACH * plan.spacing * dip;
      dx = (tx / distance) * amount;
      dy = (ty / distance) * amount;
    }
    const neck = creature.joints[1];
    head.x += dx;
    head.y += dy;
    if (neck !== undefined) {
      neck.x += dx * NECK_FOLLOWS;
      neck.y += dy * NECK_FOLLOWS;
    }
    this.pose(creature, dtS);
    head.x -= dx;
    head.y -= dy;
    if (neck !== undefined) {
      neck.x -= dx * NECK_FOLLOWS;
      neck.y -= dy * NECK_FOLLOWS;
    }
  }

  setTorpid(index: number, torpid: boolean): void {
    const creature = this.creatures[index];
    if (creature === undefined || creature.torpid === torpid) return;
    creature.torpid = torpid;
    if (torpid) curl(creature.joints, creature.plan.spacing, creature.heading);
  }

  /**
   * From now on anchored walkers keep clear of `footprints` (R5: the trees and bushes of
   * the plants they stand among), or of nothing with null. Swimmers pass under what stands
   * in the sea.
   */
  standAmong(footprints: Footprints | null): void {
    this.footprints = footprints;
  }

  /**
   * Whether a creature can stand at (x, y): on its ground, and (a walker) clear of the
   * trees and bushes by the width of its body.
   */
  private clear(creature: Creature, x: number, y: number): boolean {
    const { plan } = creature;
    if (!this.passable(x, y, plan.swims)) return false;
    const footprints = plan.swims ? null : this.footprints;
    return footprints === null || !footprints.blocked(x, y, plan.radii[creature.chest] ?? 0);
  }

  /**
   * Where the sim now has creature `index`, in cells. An anchored creature walks there
   * (or is put there, if too far to walk); a wandering one ignores it.
   */
  anchor(index: number, x: number, y: number): void {
    const creature = this.creatures[index];
    // One staged by hand keeps to what it was given, whatever the sim says meanwhile.
    if (creature?.staged === true) return;
    // One in a hunt or a birth goes there once that is over.
    if (
      creature !== undefined &&
      (creature.hunt !== undefined ||
        creature.held !== undefined ||
        creature.tending !== undefined ||
        creature.court !== undefined)
    ) {
      creature.deferred = { x, y };
      return;
    }
    const motion = creature?.motion;
    const head = creature?.joints[0];
    if (creature === undefined || motion === undefined || motion === null || head === undefined) {
      return;
    }
    const { plan } = creature;
    const walker = { head, heading: creature.heading, pace: plan.pace, length: plan.length };
    if (reanchor(motion, walker, x, y)) {
      // Put there, beside the trunk or bush it may be in (R5): the body comes along in a
      // line behind the head.
      if (this.passable(x, y, plan.swims)) {
        clearAnchor(motion, (x, y) => this.clear(creature, x, y), plan.length);
      }
      const { anchor } = motion;
      creature.joints.forEach((joint, i) => {
        joint.x = anchor.x - Math.cos(creature.heading) * plan.spacing * i;
        joint.y = anchor.y - Math.sin(creature.heading) * plan.spacing * i;
      });
    }
  }

  /** Where the sim has creature `index` (anchored), or where its head is (wandering). */
  anchorOf(index: number): Point | null {
    const creature = this.creatures[index];
    return creature?.motion?.anchor ?? creature?.joints[0] ?? null;
  }

  /** Number of sprites the active creatures are made of. */
  get spriteCount(): number {
    let total = 0;
    for (const creature of this.creatures.slice(0, this.active)) {
      total += creature?.container.children.length ?? 0;
    }
    return total;
  }

  /** Animate exactly `count` creatures; more are created on demand, extras are hidden. */
  setCount(count: number): void {
    while (this.creatures.length < count) this.creatures.push(this.spawn(this.creatures.length));
    this.active = count;
    this.refresh();
  }

  /**
   * How deep in the night it is and whether the light is rising (R5): animals fall asleep
   * and wake by it (`sleep.ts`).
   */
  nightfall(depth: number, rising: boolean, overcast = 0): void {
    this.night.depth = depth;
    this.night.rising = rising;
    this.overcast = overcast;
  }

  /**
   * What falls from the sky now (R5, `weather.ts`): animals out in rain shake it off when
   * it ends, and hunch in a thunderstorm.
   */
  weather(falling: Downpour): void {
    this.falling = falling;
  }

  /** Slot `index`'s head while it lies asleep (R5: the "z" over the animal followed), or null. */
  sleepingHead(index: number): Point | null {
    const creature = this.creatures[index];
    if (creature === undefined || !creature.sleep.asleep || creature.sleep.share < 1) return null;
    return creature.joints[0] ?? null;
  }

  /** Slot `index`'s sleep (tests and staging): night-active, asleep, how far lying down. */
  sleepOf(index: number): { owl: boolean; asleep: boolean; share: number } | null {
    const sleep = this.creatures[index]?.sleep;
    return sleep === undefined
      ? null
      : { owl: sleep.owl, asleep: sleep.asleep, share: sleep.share };
  }

  /** Show the creatures as bodies, as dots, or not at all; `only` picks a single one. */
  show(showing: Showing, only: number | null = null): void {
    if (this.showing === showing && this.only === only) return;
    if (this.showing === "hidden") this.fresh = true;
    this.showing = showing;
    this.only = only;
    this.floor.visible = showing === "bodies";
    this.over.visible = showing === "bodies";
    if (showing !== "bodies") this.foam?.clear();
    this.refresh();
  }

  /** The middle of creature `index`'s body, in cells. */
  centre(index: number): Point {
    const joints = this.creatures[index]?.joints ?? [];
    return joints[Math.floor(joints.length / 2)] ?? { x: 0, y: 0 };
  }

  /** Creature `index`'s joints from the head back, and the body's radius at each (cells; R4's glow). */
  spine(index: number): { joints: readonly Point[]; radii: readonly number[] } {
    const creature = this.creatures[index];
    return { joints: creature?.joints ?? [], radii: creature?.plan.radii ?? [] };
  }

  /** The box creature `index`'s body fills, in cells: what must show through what covers it. */
  box(index: number): CellRect {
    const creature = this.creatures[index];
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    creature?.joints.forEach((joint, i) => {
      const radius = creature.plan.radii[i] ?? 0;
      box.x0 = Math.min(box.x0, joint.x - radius);
      box.x1 = Math.max(box.x1, joint.x + radius);
      box.y0 = Math.min(box.y0, joint.y - radius);
      box.y1 = Math.max(box.y1, joint.y + radius);
    });
    return box;
  }

  /**
   * Stand every creature among the plants: `guests` holds one container per row,
   * `rowsPerCell` of them to the cell, and a creature goes in the row of its lowest
   * point, so that what grows in front of it covers it. With null they go back to the
   * layer's own container.
   */
  /**
   * The highest point of slot `index`'s body (cells): what stands in a row after it covers
   * some part of it, its head behind a bush included (R5, `PlantLayer.fade`).
   */
  topOf(index: number): number {
    let highest = Infinity;
    for (const joint of this.creatures[index]?.joints ?? []) highest = Math.min(highest, joint.y);
    return highest;
  }

  /**
   * Put slot `index`'s animal at (x, y) facing `heading` (radians), its body straight
   * behind its head, and hold it there (debugging the look: an animal placed exactly where
   * it is to be seen, as among bushes). Its legs stand where they rest.
   */
  pin(index: number, x: number, y: number, heading: number): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    creature.pinned = true;
    creature.staged = true;
    wakeNow(creature.sleep);
    creature.heading = heading;
    creature.joints.forEach((joint, i) => {
      joint.x = x - Math.cos(heading) * creature.plan.spacing * i;
      joint.y = y - Math.sin(heading) * creature.plan.spacing * i;
    });
    for (const leg of creature.legs) leg.planted = false;
    if (creature.motion !== null) {
      creature.motion.anchor.x = x;
      creature.motion.anchor.y = y;
    }
  }

  /**
   * Let slot `index`'s animal go from where it is to (x, y) as it goes to where the sim has
   * it, steering round plants on the way (debugging the look: a walk staged by hand).
   */
  send(index: number, x: number, y: number): void {
    const creature = this.creatures[index];
    if (creature === undefined || creature.motion === null) return;
    creature.pinned = false;
    creature.staged = true;
    rouse(creature.sleep);
    creature.motion.anchor.x = x;
    creature.motion.anchor.y = y;
    creature.motion.mode = "travel";
    creature.motion.goal.x = x;
    creature.motion.goal.y = y;
  }

  /**
   * What `occluders.over` answers for `creature` (slot `index`, rows `highest` to `lowest`),
   * asked again only when its joints, the rows or the plants have changed since (R5,
   * review P2: asked of every animal in sight every frame, most of them standing still).
   */
  private overOf(
    creature: Creature,
    index: number,
    occluders: Occluders,
    highest: number,
    lowest: number,
  ): number {
    const { joints } = creature;
    const changes = occluders.changes;
    let kept = creature.over;
    if (
      changes !== undefined &&
      kept !== null &&
      kept.occluders === occluders &&
      kept.changes === changes &&
      kept.highest === highest &&
      kept.lowest === lowest &&
      sameJoints(kept.joints, joints)
    ) {
      return kept.answer;
    }
    const answer = occluders.over(this.box(index), highest, lowest, joints, creature.plan.radii);
    if (kept === null || kept.joints.length !== joints.length * 2) {
      kept = {
        occluders,
        changes: -1,
        highest,
        lowest,
        joints: new Float64Array(joints.length * 2),
        answer,
      };
      creature.over = kept;
    }
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i] as Point;
      kept.joints[2 * i] = joint.x;
      kept.joints[2 * i + 1] = joint.y;
    }
    kept.occluders = occluders;
    kept.changes = changes ?? -1;
    kept.highest = highest;
    kept.lowest = lowest;
    kept.answer = answer;
    return answer;
  }

  /** The lowest point of slot `index`'s body (cells): the row `hostIn` stands it in. */
  footOf(index: number): number {
    let lowest = -Infinity;
    for (const joint of this.creatures[index]?.joints ?? []) lowest = Math.max(lowest, joint.y);
    return lowest;
  }

  hostIn(
    guests: readonly Container[] | null,
    rowsPerCell = 1,
    occluders: Occluders | null = null,
  ): void {
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature === undefined) continue;
      if (guests === null) {
        if (creature.container.parent !== this.container)
          this.container.addChild(creature.container);
        continue;
      }
      // Out of sight it is not drawn, so it waits where it is: `update` has just said what
      // is in sight, and an animal coming into it is put in its row in the same frame.
      if (!creature.inView && creature.container.parent !== null) continue;
      const last = guests.length - 1;
      let lowest = 0;
      let highest = last;
      for (const joint of creature.joints) {
        const row = Math.min(Math.max(Math.floor(joint.y * rowsPerCell), 0), last);
        lowest = Math.max(lowest, row);
        highest = Math.min(highest, row);
      }
      // An animal is seen from above, so a tree's or a bush's leaves are over it wherever
      // the plant's drawing overlaps it, whichever side of the plant its feet are (R5:
      // drawn by the row of its feet alone, an animal in front of a bush or across one
      // seemed to lie on top of it). It goes in the row before the first plant that
      // overlaps it; grass and small things keep to the rows of its feet.
      let row = lowest;
      if (
        occluders !== null &&
        creature.inView &&
        !creature.plan.swims &&
        creature.arriving === undefined
      ) {
        const under = this.overOf(creature, index, occluders, highest, lowest);
        if (under >= 0) row = Math.min(lowest, Math.max(under - 1, 0));
      }
      const host = guests[row] ?? this.container;
      if (creature.container.parent !== host) host.addChild(creature.container);
    }
  }

  /**
   * Move every creature on by `dtS` seconds. Bodies are worked out only for those in
   * `view` (all of them when it is left out), and not at all with `posed` false, as when
   * they are shown as dots: the others walk on as a head and a chain.
   */
  update(dtS: number, view?: CellRect, posed = true): void {
    this.clock += dtS;
    this.depart(dtS);
    this.flecks?.update(dtS);
    this.dust?.update(dtS);
    this.nursery?.update(dtS);
    this.sparks?.update(dtS);
    this.foam?.update(dtS);
    const sun = sunny(this.night.depth, this.overcast);
    const fresh = this.fresh;
    this.fresh = false;
    this.ticks += 1;
    const lived = dtS;
    const hats = isChristmasActive() && this.showing === "bodies";
    this.packs(dtS);
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature === undefined) continue;
      // Out of sight, it lives every few updates, with their time (only with a view: tests
      // and films without one move every animal every update).
      dtS = lived;
      if (view !== undefined && !creature.inView && !fresh && creature.arriving === undefined) {
        creature.lag += dtS;
        if ((this.ticks + index) % OUT_OF_SIGHT_EVERY !== 0) continue;
        dtS = creature.lag;
      }
      creature.lag = 0;
      // Asleep at night, or getting up (R5): it lies where it is; a hunter or a mother
      // tending her young does not sleep.
      const busy =
        creature.hunt !== undefined ||
        creature.held !== undefined ||
        creature.tending !== undefined ||
        creature.court !== undefined;
      const lying =
        !busy &&
        doze(
          creature,
          this.night,
          dtS,
          creature.wet === "dry" || creature.wet === "feet",
          creature.arriving !== undefined,
          fresh,
        );
      if (lying) creature.hurried = false;
      this.rain(creature, busy, dtS);
      // A photosynthesiser standing about in the sun on dry land basks (R5, `basking.ts`).
      if (creature.basks) this.sunbathe(creature, sun && !busy && !lying, dtS);
      // A torpid animal lies where it is, and so do a sleeper, a newborn and its mother for
      // its birth; a hunter hunts; the others move.
      const still =
        creature.torpid ||
        creature.pinned === true ||
        lying ||
        creature.held !== undefined ||
        creature.tending !== undefined;
      const head = still
        ? (creature.joints[0] ?? { x: 0, y: 0 })
        : creature.hunt !== undefined
          ? this.chase(creature, creature.hunt, dtS)
          : creature.motion === null
            ? this.wander(creature, dtS)
            : this.live(creature, dtS);
      this.endMoments(creature, index, dtS);
      if (creature.wakes) this.wake(creature, head, dtS);
      // In sight, with room for the whole body to stick into the picture.
      const reach = creature.plan.length + 1;
      const inView =
        view === undefined ||
        (head.x >= view.x0 - reach &&
          head.x <= view.x1 + reach &&
          head.y >= view.y0 - reach &&
          head.y <= view.y1 + reach);
      if (inView && posed) {
        this.shakeOff(creature, dtS);
        // Posed on two updates in three where asked, the missed time given at the next.
        creature.poseLag += dtS;
        if (!this.posedSparsely || (this.ticks + index) % POSE_SKIP_EVERY !== 0) {
          this.eat(creature, creature.poseLag);
          creature.poseLag = 0;
        }
        if (creature.plan.swims && creature.arriving === undefined) this.wet(creature, head);
        else if (creature.motion !== null && creature.arriving === undefined) {
          this.wade(creature, head);
        }
      }
      if (creature.arriving !== undefined) {
        creature.arriving.age += dtS;
        this.materialise(creature);
      }
      creature.hat.visible = hats;
      if (creature.inView !== inView) {
        creature.inView = inView;
        this.reveal(creature, index);
      }
    }
    dtS = lived;
    this.spray?.update(dtS);
    this.fell = this.falling;
  }

  /**
   * The packs (the Packs and Rivals mod, `creatures/pack.ts`), looked
   * at once every `PACK_EVERY_S`: strolls steered, face-offs played, the nests drawn. Off,
   * the nests are put away.
   */
  private packs(dtS: number): void {
    if (!isPackWarfareActive()) {
      this.packLag = 0;
      for (const nest of this.nests) nest.visible = false;
      return;
    }
    this.packLag += dtS;
    if (this.packLag < PACK_EVERY_S) return;
    const lived = this.packLag;
    this.packLag = 0;
    // Mothers: tending a brood, or trailed by a young one.
    for (const creature of this.creatures) {
      if (creature !== undefined) creature.nurturing = creature.tending !== undefined;
    }
    for (const creature of this.creatures) {
      if (creature?.leader === undefined) continue;
      const mother = this.creatures[creature.leader];
      if (mother !== undefined && mother !== creature) mother.nurturing = true;
    }
    this.drawNests(updatePackDynamics(this.creatures, lived, this.packHooks));
  }

  /** Whether the packs may steer an animal: not hunting, eating, asleep, held or shaking. */
  private steerable(creature: Creature): boolean {
    return (
      creature.motion !== null &&
      !creature.torpid &&
      creature.pinned !== true &&
      creature.staged !== true &&
      creature.arriving === undefined &&
      creature.hunt === undefined &&
      creature.held === undefined &&
      creature.tending === undefined &&
      creature.court === undefined &&
      creature.food === "none" &&
      creature.sleep.share === 0 &&
      creature.drench.age < 0
    );
  }

  /** Sparks rising between two rivals facing off at (x, y), cells. */
  private skirmish(x: number, y: number): void {
    if (this.showing !== "bodies") return;
    if (isDramaticDirectorActive()) {
      dramaticDirector.recordClash(0, 0, x, y);
    }
    const pool = this.sparkPool();
    const kind = skirmishKind();
    for (let k = 0; k < SKIRMISH_SPARKS; k++) {
      const aside = (k - (SKIRMISH_SPARKS - 1) / 2) * SKIRMISH_RISE;
      pool.emit(kind, SKIRMISH_COLOUR, x, y, aside, -SKIRMISH_RISE, k * 0.1);
    }
  }

  /** A nest of twigs and stones at each colony's middle, on land; the others put away. */
  private drawNests(nests: readonly Nest[]): void {
    const { pixels } = this.body;
    let drawn = 0;
    for (const nest of nests) {
      if (!this.passable(nest.x, nest.y, false)) continue;
      const look = nestTextures(nestLook(nest.species));
      let sprite = this.nests[drawn];
      if (sprite === undefined) {
        sprite = new Sprite({ texture: look.twigs, anchor: 0.5 });
        sprite.scale.set(1 / pixels);
        sprite.addChild(new Sprite({ texture: look.stones, anchor: 0.5 }));
        this.floor.addChild(sprite);
        this.nests.push(sprite);
      }
      const stones = sprite.children[0];
      sprite.texture = look.twigs;
      sprite.tint = NEST_TWIGS;
      if (stones instanceof Sprite) {
        stones.texture = look.stones;
        stones.tint = NEST_STONES;
      }
      // On the art pixels' grid, as everything drawn in the scene.
      sprite.position.set(
        Math.round(nest.x * pixels) / pixels,
        Math.round(nest.y * pixels) / pixels,
      );
      sprite.visible = true;
      drawn++;
    }
    for (let k = drawn; k < this.nests.length; k++) {
      const sprite = this.nests[k];
      if (sprite !== undefined) sprite.visible = false;
    }
  }

  /**
   * An animal in the weather (R5, `weather.ts`): soaked while out in rain, shaking it off
   * once the spell is over (it stops where it is unless the sim moves it on), hunched in a
   * thunderstorm. Swimmers, the torpid, sleepers and those in deep water are left alone.
   */
  private rain(creature: Creature, busy: boolean, dtS: number): void {
    const { drench: state, motion } = creature;
    const exposed =
      !creature.plan.swims &&
      !creature.torpid &&
      creature.sleep.share === 0 &&
      creature.wet !== "deep" &&
      creature.arriving === undefined &&
      !busy;
    const moment = (creature.breathOffset * 7.919) % 1;
    const shaking = drench(state, this.falling, this.fell, exposed, moment, dtS);
    if (shaking && motion !== null && motion.mode !== "travel") {
      motion.mode = "pause";
      motion.timer = Math.max(motion.timer, 0.1);
      motion.look = creature.heading;
      motion.facing = creature.heading;
    }
    huddleToward(state, this.falling === "storm" && exposed ? 1 : 0, dtS);
  }

  /** Drops flung off a shaking animal in sight, from one joint after another, either side. */
  private shakeOff(creature: Creature, dtS: number): void {
    const { age } = creature.drench;
    if (age < 0 || !sprays(age - dtS, age)) return;
    const { joints, plan } = creature;
    const k = Math.floor(age * 97) % Math.max(joints.length - 1, 1);
    const joint = joints[k];
    if (joint === undefined) return;
    if (this.spray === null) {
      this.spray = new Spray(this.atlas.white, DROP_PIXELS / this.body.pixels, WHITE_TEXELS);
      this.container.addChild(this.spray.container);
    }
    const reach = plan.radii[k] ?? 0;
    this.spray.throw(joint, creature.heading, 1, reach);
    this.spray.throw(joint, creature.heading, -1, reach);
  }

  private refresh(): void {
    this.creatures.forEach((creature, index) => {
      if (creature !== undefined) this.reveal(creature, index);
    });
  }

  /** Show a creature or not: by the count, the choice of one, the way of showing, the view. */
  private reveal(creature: Creature, index: number): void {
    const chosen = index < this.active && (this.only ?? index) === index;
    creature.container.visible = chosen && this.showing === "bodies" && creature.inView;
    creature.marker.visible = chosen && this.showing === "markers";
  }

  /** The nearest cell to (x, y) this body can live in, searching outward in rings. */
  private settle(x: number, y: number, swims: boolean): Point {
    for (let reach = 0; reach <= SETTLE_REACH; reach++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          // Only the ring at this distance: the inside was searched already.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach) continue;
          if (this.passable(x + dx, y + dy, swims)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x, y };
  }

  private spawn(index: number): Creature {
    const seed = this.seeds[index % this.seeds.length];
    if (seed === undefined) throw new Error("the fixture has no creatures");
    // Past the fixture's creatures, reuse them a few cells away.
    return this.spawnFrom(seed, index >= this.seeds.length);
  }

  private spawnFrom(seed: CreatureSeed, clone: boolean): Creature {
    const random = this.random;
    const plan = bodyPlan(seed, this.body, kindFor(seed, this.plans));
    const { x, y } = this.settle(
      seed.x + (clone ? (random() - 0.5) * 8 : 0),
      seed.y + (clone ? (random() - 0.5) * 8 : 0),
      plan.swims,
    );
    const heading = random() * Math.PI * 2;
    const joints = Array.from({ length: plan.joints }, (_, i) => ({
      x: x - Math.cos(heading) * plan.spacing * i,
      y: y - Math.sin(heading) * plan.spacing * i,
    }));
    if (seed.torpid) curl(joints, plan.spacing, heading);

    const container = new Container();
    this.container.addChild(container);
    // Legs first: the body covers the hips. All their edges go under all of the legs.
    const bar = (tint: number): Sprite => {
      const sprite = new Sprite({ texture: this.atlas.white, anchor: { x: 0, y: 0.5 } });
      sprite.tint = tint;
      return container.addChild(sprite);
    };
    /** A foot: round, or with `webbed` a paddle, an oval wider than it is long. */
    const round = (tint: number, radius: number, webbed = false): Sprite => {
      const sprite = new Sprite({ texture: this.atlas.disc, anchor: 0.5 });
      sprite.tint = tint;
      const across = (2 * radius) / DISC_SIZE;
      if (webbed) sprite.scale.set(across * WEB_LONG, across * WEB_WIDE);
      else sprite.scale.set(across);
      return container.addChild(sprite);
    };
    /** A flipper: an oval blade, held near one end; `margin` wider all round for its edge. */
    const blade = (tint: number, length: number, width: number, margin = 0): Sprite => {
      const long = length + 2 * margin;
      const sprite = new Sprite({
        texture: this.atlas.disc,
        anchor: { x: (FLIPPER_ROOT * length + margin) / long, y: 0.5 },
      });
      sprite.tint = tint;
      sprite.scale.set(long / DISC_SIZE, (width + 2 * margin) / DISC_SIZE);
      return container.addChild(sprite);
    };
    const edges = plan.legs.map((leg): Sprite[] => {
      // The dark edge of a leg is the colour of the outline round the body.
      const edge = plan.outline;
      if (leg.edge === 0) return [];
      if (leg.fin === 1) return [blade(edge, leg.length, leg.thickness, leg.edge)];
      const bones = [bar(edge), bar(edge)];
      return leg.foot > 0 ? [...bones, round(edge, leg.foot + leg.edge, leg.fin > 0)] : bones;
    });
    const legs = plan.legs.map((leg, index): Leg => {
      const flipper = leg.fin === 1;
      // Legs come in pairs, front first: the pair's two sides half a cycle apart, and
      // each pair against the one in front, so that diagonal feet swing together.
      const pair = Math.floor(index / 2);
      const phase = ((pair % 2) * 0.5 + (leg.side === 1 ? 0 : 0.5) + pair * PAIR_LAG) % 1;
      return {
        plan: leg,
        foot: { x, y },
        target: { x, y },
        upper: flipper ? blade(leg.sole, leg.length, leg.thickness) : bar(leg.colour),
        lower: flipper ? null : bar(leg.colour),
        edges: edges[index] ?? [],
        sole: !flipper && leg.foot > 0 ? round(leg.sole, leg.foot, leg.fin > 0) : null,
        webbed: leg.fin > 0,
        planted: false,
        phase,
        swinging: false,
        lift: { x, y },
      };
    });
    // The gait is measured in the shortest leg that steps (flippers row, `walk`).
    const steppers = plan.legs.filter((leg) => leg.fin < 1).map((leg) => leg.length);
    const shortest = steppers.length > 0 ? Math.min(...steppers) : 0;
    const textures: Record<string, [Texture, number]> = {
      disc: [this.atlas.disc, DISC_SIZE],
      wedge: [this.atlas.wedge, DISC_SIZE],
      bar: [this.atlas.white, WHITE_TEXELS],
    };
    const sprites = plan.parts.map((part) => {
      const [texture, texels] = textures[part.shape] ?? [this.atlas.disc, DISC_SIZE];
      const sprite = new Sprite({ texture, anchor: 0.5 });
      sprite.tint = part.colour;
      sprite.alpha = part.alpha ?? 1;
      sprite.scale.set(part.along / texels, part.across / texels);
      return container.addChild(sprite);
    });

    const hat = this.hatFor(plan.radii[0] ?? 0);
    container.addChild(hat);

    const stiff = stiffness(plan.kind, plan.joints, plan.spacing);
    // The dot that stands for it on the map: its colour, with a dark edge.
    const marker = new Container();
    // The young are the smallest dots, whatever they will grow to.
    const young = seed.growth !== undefined && seed.growth < 1;
    const dot = dotOf(young ? "small" : dotSize(seed.mass), plan.swims);
    for (const [texture, tint] of [
      [dot.edge, MARKER_EDGE],
      [dot.fill, plan.colour],
    ] as const) {
      const pixels = new Sprite({ texture, anchor: 0.5 });
      pixels.tint = tint;
      pixels.scale.set(1 / MAP_TILE);
      marker.addChild(pixels);
    }
    marker.visible = false;
    this.container.addChild(marker);

    return {
      plan,
      species: seed.species !== 0 ? seed.species : -1 - plan.colour,
      young,
      nurturing: false,
      pack: newPackState(),
      motion: this.life === "anchored" ? newMotion({ x, y }, heading) : null,
      chest: plan.radii.indexOf(Math.max(...plan.radii)),
      breathOffset: random(),
      mass: seed.mass,
      torpid: seed.torpid,
      paints: container.children
        .filter((child): child is Sprite => child instanceof Sprite)
        .map((sprite) => ({ sprite, colour: sprite.tint, alpha: sprite.alpha })),
      seaKey: -1,
      effort: effortOf(seed.aquatic),
      wet: "dry",
      waterPace: 1,
      ripples: null,
      legSprites: null,
      food: "none",
      bitePhase: 0,
      pen: seed.pen,
      container,
      marker,
      joints,
      stiffness: stiff,
      sleep: sleeperOf(
        seed.genome,
        seed.rare ?? [],
        { swims: plan.swims, joints: plan.joints, parts: plan.parts, stiffness: stiff },
        sprites,
        LAYER.face,
      ),
      hurried: false,
      drench: drenchOf(),
      basks: seed.rare?.includes("leaves") === true,
      venomous: seed.rare?.includes("venom") === true,
      wakes: plan.swims || seed.rare?.includes("gills") === true,
      basker: newBasker(),
      spread: false,
      swamFrom: { x, y },
      swum: 0,
      heading,
      turn: 0,
      avoid: random() < 0.5 ? 1 : -1,
      stroke: random() * Math.PI * 2,
      gait: random(),
      stride: STRIDE_LEGS * shortest,
      walked: 0,
      striding: 0,
      unsettled: true,
      sprites,
      hat,
      legs,
      inView: true,
      lag: 0,
      poseLag: 0,
      posed: null,
      over: null,
    };
  }

  /**
   * A Santa hat for a head of `radius` cells, its brim's middle at (0, 0): a red cone
   * leaning a little, a white brim and a white pom-pom at its tip, of the atlas's shapes.
   */
  private hatFor(radius: number): Container {
    const hat = new Container();
    const lean = -Math.PI / 2 + HAT_LEAN;
    const tall = HAT_TALL * radius;
    const cone = new Sprite({ texture: this.atlas.wedge, anchor: { x: 0, y: 0.5 } });
    cone.tint = HAT_RED;
    cone.rotation = lean;
    cone.scale.set(tall / DISC_SIZE, (HAT_WIDE * radius) / DISC_SIZE);
    const brim = new Sprite({ texture: this.atlas.white, anchor: 0.5 });
    brim.tint = HAT_WHITE;
    brim.scale.set(
      (HAT_BRIM_WIDE * radius) / WHITE_TEXELS,
      (HAT_BRIM_DEEP * radius) / WHITE_TEXELS,
    );
    const pom = new Sprite({ texture: this.atlas.disc, anchor: 0.5 });
    pom.tint = HAT_WHITE;
    pom.scale.set((HAT_POM * radius) / DISC_SIZE);
    pom.position.set(Math.cos(lean) * tall, Math.sin(lean) * tall);
    hat.addChild(cone, brim, pom);
    hat.visible = false;
    return hat;
  }

  /** Colour a swimmer as seen through the water at its head, when that water changes. */
  private wet(creature: Creature, head: Point): void {
    const sea = this.sea?.(head.x, head.y) ?? null;
    const key = seaKey(sea);
    if (key === creature.seaKey) return;
    creature.seaKey = key;
    for (const { sprite, colour, alpha } of creature.paints) {
      if (sea === null) {
        sprite.tint = colour;
        sprite.alpha = alpha;
      } else if (alpha < 1) {
        // The one see-through part is its shadow on the bottom.
        sprite.alpha = shadowUnderWater(alpha, sea);
      } else {
        sprite.tint = underWater(colour, sea, colour === GLINT, this.water);
      }
    }
    // Glass: the body is see-through as one, so that its parts do not show through each other.
    const opacity = sea === null ? 1 : opacityUnderWater(sea, this.water);
    if (opacity < 1) {
      creature.glass ??= new AlphaFilter();
      creature.glass.alpha = opacity;
      creature.container.filters = [creature.glass];
    } else {
      creature.container.filters = [];
    }
  }

  /**
   * Pose an animal, with its head at work if it stands eating (R5, `eating.ts`): moved
   * for the drawing only, the chain put back after; a fleck now and then from its mouth.
   */
  private eat(creature: Creature, dtS: number): void {
    const head = creature.joints[0];
    // A hunter thrusts its head at its prey, a mother lowers hers to her newborn (R5).
    if (
      head !== undefined &&
      (creature.hunt?.from != null ||
        creature.tending !== undefined ||
        creature.court !== undefined)
    ) {
      this.reach(creature, head, dtS);
      return;
    }
    const eating =
      creature.food !== "none" &&
      head !== undefined &&
      creature.sleep.share === 0 &&
      creature.motion !== null &&
      creature.motion.mode === "pause" &&
      !creature.torpid &&
      creature.arriving === undefined &&
      creature.hunt === undefined &&
      creature.wet !== "deep";
    if (!eating) {
      this.pose(creature, dtS);
      return;
    }
    const { forward, aside, phase, count } = bite(
      creature.food,
      this.clock,
      creature.breathOffset,
      creature.plan.spacing,
    );
    const cos = Math.cos(creature.heading);
    const sin = Math.sin(creature.heading);
    const dx = cos * forward - sin * aside;
    const dy = sin * forward + cos * aside;
    // The neck goes half as far, so the head stays on it as it reaches.
    const neck = creature.joints[1];
    head.x += dx;
    head.y += dy;
    if (neck !== undefined) {
      neck.x += dx * NECK_FOLLOWS;
      neck.y += dy * NECK_FOLLOWS;
    }
    this.pose(creature, dtS);
    if (flecks(creature.food, creature.bitePhase, phase, count) && creature.inView) {
      const reach = creature.plan.radii[0] ?? 0;
      this.fleckPool().throw(
        creature.food,
        { x: head.x + cos * reach, y: head.y + sin * reach },
        count % 2 === 0 ? 1 : -1,
      );
    }
    creature.bitePhase = phase;
    head.x -= dx;
    head.y -= dy;
    if (neck !== undefined) {
      neck.x -= dx * NECK_FOLLOWS;
      neck.y -= dy * NECK_FOLLOWS;
    }
  }

  /**
   * A walker in the water (R5, `creatures/wading.ts`): wading in the shallows its legs are
   * under the water; out of its depth they are gone from sight and its body is sunk but for
   * its head, and it bobs; ripples spread from it either way, and it goes slower, all as
   * much as the water is hard for it.
   */
  private wade(creature: Creature, head: Point): void {
    const water = this.sea?.(head.x, head.y) ?? null;
    const inWater = wetOf(water?.below ?? 0);
    // On the beach, the swash may run over its feet (R5, the owner: wet feet at high tide).
    const wet: Wet = inWater === "dry" && this.swash?.(head.x, head.y) === true ? "feet" : inWater;
    const sea = wet === "feet" ? SWASH_SEA : water;
    const { effort } = creature;
    creature.wet = wet;
    creature.waterPace = paceIn(wet, effort);
    if (wet === "dry" && creature.ripples === null) return;
    // Colours change only when the water does.
    const key =
      wet === "dry" ? -1 : (wet === "feet" ? 500 : wet === "shallow" ? 1000 : 2000) + seaKey(sea);
    if (key !== creature.seaKey) {
      creature.seaKey = key;
      creature.legSprites ??= new Set(
        creature.legs.flatMap((leg) => [
          leg.upper,
          ...(leg.lower === null ? [] : [leg.lower]),
          ...leg.edges,
          ...(leg.sole === null ? [] : [leg.sole]),
        ]),
      );
      const jointOf = new Map(
        creature.sprites.map((sprite, i) => [sprite, creature.plan.parts[i]?.joint ?? 0]),
      );
      for (const { sprite, colour, alpha } of creature.paints) {
        const leg = creature.legSprites.has(sprite);
        const sunk = sea !== null && (leg || (wet === "deep" && (jointOf.get(sprite) ?? 0) > 0));
        if (wet === "deep" && leg) {
          sprite.alpha = 0;
        } else if (sunk && alpha >= 1) {
          sprite.tint = underWater(colour, sea, false, this.water);
          sprite.alpha = alpha;
        } else {
          sprite.tint = colour;
          // Its shadow on the ground does not fall on the water.
          sprite.alpha = alpha < 1 && wet !== "dry" ? 0 : alpha;
        }
      }
    }
    creature.container.y = bobAt(wet, effort, this.clock, creature.breathOffset);
    // Rings spread from its widest part.
    const chest = creature.joints[creature.chest] ?? head;
    if (wet !== "dry" && creature.ripples === null) {
      creature.ripples = Array.from({ length: RIPPLES }, () => {
        const ring = new Sprite({ texture: ringTexture(3), anchor: 0.5 });
        ring.tint = RIPPLE_TINT;
        return creature.container.addChildAt(ring, 0);
      });
    }
    creature.ripples?.forEach((ring, k) => {
      const ripple = rippleAt(wet, effort, creature.plan.length, this.clock, k);
      ring.visible = ripple !== null;
      if (ripple === null) return;
      ring.texture = ringTexture(ripple.across * this.body.pixels);
      ring.scale.set(1 / this.body.pixels);
      ring.alpha = ripple.alpha;
      ring.position.set(chest.x, chest.y - creature.container.y);
    });
  }

  /** Anchored: live near where the sim has it, and pull the chain after the head. */
  private live(creature: Creature, dtS: number): Point {
    const { plan, joints, motion } = creature;
    const head = joints[0] ?? { x: 0, y: 0 };
    if (motion === null) return head;
    const { stiffness: stiff } = creature;
    const { walker } = this;
    walker.head = head;
    walker.heading = creature.heading;
    // A hunter runs (R5, `hunting.ts`); a mate trots up to the mother (`family.ts`).
    // Hunched in a thunderstorm it goes slower (R5, `weather.ts`).
    walker.pace =
      plan.pace *
      creature.waterPace *
      (creature.hunt?.speed ?? 1) *
      (1 - HUDDLE_SLOW * creature.drench.huddle) *
      (creature.court === undefined ? 1 : COURT_TROT);
    walker.length = plan.length;
    // A body that turns on the spot lets its head turn as it likes, and comes round after.
    walker.neck = stiff.pivots ? undefined : neckDirection(joints, creature.heading);
    walker.bend = stiff.neck;
    walker.turning = stiff.turning;
    // Eating, it stands where it is and keeps its head down: no stroll, no looking about.
    if (creature.food !== "none" && motion.mode !== "travel" && creature.hunt === undefined) {
      motion.mode = "pause";
      motion.timer = Math.max(motion.timer, EAT_HOLD_S);
      motion.look = creature.heading;
      motion.facing = creature.heading;
    }
    this.living = creature;
    const ground = this.livingGround;
    const free = this.livingFree;
    // Where the sim has it is drawn beside the plant it may be in, not on it (R5).
    const { anchor } = motion;
    if (ground(anchor.x, anchor.y)) clearAnchor(motion, free, plan.length);
    // Paused with its tail in a bush or on a trunk: it steps out.
    const tail = joints[joints.length - 1];
    if (motion.mode === "pause" && tail !== undefined && ground(tail.x, tail.y)) {
      if (!free(tail.x, tail.y) && free(head.x, head.y)) stepOut(motion, walker, free);
    }
    this.family(creature, motion);
    const stride = drive(motion, walker, dtS, this.random, free, ground);
    creature.hurried = !plan.swims && creature.wet === "dry" && hurries(motion, head, plan.length);
    creature.heading = walker.heading;
    creature.walked += stride;
    if (stiff.pivots) pivot(joints, creature.heading, stiff.neck);
    creature.stroke += (stride / plan.length) * STROKES_PER_LENGTH * 2 * Math.PI;
    followChain(joints, plan.spacing, stiff, creature.heading, dtS);
    creature.marker.position.set(head.x, head.y);
    return head;
  }

  /**
   * Family life (R5, `family.ts`): a mate stands facing the mother it courts once it is by
   * her; a young one near the one it trails (its mother, or an elder of its brood) keeps
   * a little behind and to the side of it, within its own leash.
   */
  private family(creature: Creature, motion: Motion): void {
    motion.following = false;
    const { court } = creature;
    if (court !== undefined) {
      const head = creature.joints[0];
      const other = this.creatures[court.with]?.joints[0];
      if (motion.mode !== "pause" || head === undefined || other === undefined) return;
      const toward = Math.atan2(other.y - head.y, other.x - head.x);
      motion.look = toward;
      motion.facing = toward;
      motion.timer = Math.max(motion.timer, court.lasts - court.age);
      return;
    }
    const leader = creature.leader === undefined ? undefined : this.creatures[creature.leader];
    if (leader === undefined || leader === creature || leader.motion === null) return;
    if (creature.food !== "none" || creature.hunt !== undefined) return;
    const mine = motion.anchor;
    const theirs = leader.motion.anchor;
    if (Math.hypot(theirs.x - mine.x, theirs.y - mine.y) > FAMILY_NEAR_CELLS) return;
    const own = creature.plan.radii[0] ?? 0;
    if (!trailSpot(leader.joints, leader.plan.radii, own, creature.avoid, this.trailAt)) return;
    trail(motion, creature.plan.length, this.trailAt.x, this.trailAt.y);
  }

  /**
   * Young slot `index` trails slot `leader` from now on (R5, `family.ts`): its mother, or
   * an elder of its brood; no one with null.
   */
  follow(index: number, leader: number | null): void {
    const creature = this.creatures[index];
    if (creature !== undefined) creature.leader = leader ?? undefined;
  }

  /** Walk the head on and pull the chain after it. Returns the head. */
  private wander(creature: Creature, dtS: number): Point {
    const { plan, joints } = creature;
    const head = joints[0] ?? { x: 0, y: 0 };
    const random = this.random;

    // Wander, turning away from where this body cannot go.
    creature.turn += ((random() * 2 - 1) * TURN_JITTER - creature.turn * TURN_DAMPING) * dtS;
    let dirX = Math.cos(creature.heading);
    let dirY = Math.sin(creature.heading);
    const { pen } = creature;
    const free = (x: number, y: number): boolean =>
      this.passable(x, y, plan.swims) &&
      (pen === undefined || (x >= pen.x0 && x <= pen.x1 && y >= pen.y0 && y <= pen.y1));
    const blocked = !free(head.x + dirX * LOOK_AHEAD_CELLS, head.y + dirY * LOOK_AHEAD_CELLS);
    creature.heading += (blocked ? creature.avoid * AVOID_TURN : creature.turn) * dtS;
    // The head turns no further from the body than its neck lets it, and the body comes
    // round after; stopped in front of what it cannot cross, or short and stiff, it turns
    // on the spot.
    const { stiffness: stiff } = creature;
    if (blocked || stiff.pivots) {
      pivot(joints, creature.heading, stiff.neck);
    } else {
      creature.heading = withinTurn(
        creature.heading,
        neckDirection(joints, creature.heading),
        stiff.neck,
      );
    }
    dirX = Math.cos(creature.heading);
    dirY = Math.sin(creature.heading);
    const stride = plan.pace * dtS;
    const stuck = !free(head.x, head.y);
    if (!blocked || stuck) {
      head.x += dirX * stride;
      head.y += dirY * stride;
      creature.walked += stride;
      creature.stroke += (stride / plan.length) * STROKES_PER_LENGTH * 2 * Math.PI;
    }
    followChain(joints, plan.spacing, creature.stiffness, creature.heading, dtS);
    creature.marker.position.set(head.x, head.y);
    return head;
  }

  /** Put every part and leg of the body where the chain now is. */
  private pose(creature: Creature, dtS: number): void {
    const { plan, joints } = creature;
    // Shaking off the rain, or hunched in a storm (R5): its joints moved for the drawing
    // only, put back after.
    const moved = this.weathered(creature);
    const low = 1 - HUDDLE_LOW * creature.drench.huddle;
    // Basking (R5), it is pressed flat and spread out: wider, its parts further out to its
    // sides, lower toward the ground; drawn back as it was once it is up.
    const flat = creature.basker.share * creature.basker.share * (3 - 2 * creature.basker.share);
    const widen = flat > 0 || creature.spread;
    creature.spread = flat > 0;
    const spreads = 1 + BASK_SPREADS * flat;
    const lowers = 1 - BASK_LOWERS * flat;
    const widens = 1 + BASK_WIDENS * flat;
    // The gait moves on first (the parts do not read it, the legs do).
    this.step(creature, dtS);
    creature.unsettled = false;
    // Posed from just what it was posed from last time (R5, the board: standing, grazing
    // between steps, asleep), every part and leg would come out where it is: only the
    // chest, breathing, is posed again.
    if (!moved && this.posedAsBefore(creature)) {
      this.breathe(creature, dtS, widens);
      return;
    }
    // Which way the body points at each joint: the head where it is going, the others
    // toward the joint in front.
    this.dirX[0] = Math.cos(creature.heading);
    this.dirY[0] = Math.sin(creature.heading);
    this.angle[0] = creature.heading;
    for (let i = 1; i < joints.length; i++) {
      const joint = joints[i];
      const lead = joints[i - 1];
      if (joint === undefined || lead === undefined) continue;
      const span = Math.hypot(lead.x - joint.x, lead.y - joint.y) || 1;
      this.dirX[i] = (lead.x - joint.x) / span;
      this.dirY[i] = (lead.y - joint.y) / span;
      this.angle[i] = Math.atan2(lead.y - joint.y, lead.x - joint.x);
    }

    for (let i = 0; i < plan.parts.length; i++) {
      const part = plan.parts[i];
      const sprite = creature.sprites[i];
      const joint = part === undefined ? undefined : joints[part.joint];
      if (part === undefined || sprite === undefined || joint === undefined) continue;
      const forwardX = this.dirX[part.joint] ?? 1;
      const forwardY = this.dirY[part.joint] ?? 0;
      // To the body's left is its direction turned a quarter.
      const side = part.side * spreads;
      const lift = part.lift * lowers;
      sprite.position.set(
        joint.x + forwardX * part.forward - forwardY * side - lift * LIGHT * low,
        joint.y + forwardY * part.forward + forwardX * side - lift * LIGHT * low,
      );
      sprite.rotation = (this.angle[part.joint] ?? 0) + part.turn;
      // Its eyes keep their size (sleep narrows them), its shadow too (pressed to the
      // ground, it casts no more of one); the rest widens.
      if (widen && part.layer !== LAYER.face && part.layer !== LAYER.ground) {
        const texels = part.shape === "bar" ? WHITE_TEXELS : DISC_SIZE;
        sprite.scale.y = (part.across / texels) * widens;
      }
      // The chest breathes: its masses (not what lies on them) widen and narrow.
      if (part.joint === creature.chest && part.layer > LAYER.ground && part.layer <= LAYER.light) {
        // Asleep it breathes slower and deeper (R5), on its own clock so that it does not jump.
        const clock = creature.torpid
          ? this.clock / TORPID_BREATH
          : breathClock(creature.sleep, dtS);
        const full = breath(clock, creature.mass, creature.breathOffset);
        const texels = part.shape === "bar" ? WHITE_TEXELS : DISC_SIZE;
        const deeper = BREATH_WIDENS * breathDepth(creature.sleep);
        sprite.scale.y = (part.across / texels) * (1 + deeper * full) * widens;
      }
    }
    const top = joints[0];
    if (top !== undefined) {
      const radius = plan.radii[0] ?? 0;
      creature.hat.position.set(top.x, top.y - HAT_ABOVE * radius * low * lowers);
    }
    for (const leg of creature.legs) this.walk(creature, leg);
    if (moved) {
      for (let i = 0; i < joints.length && i < this.heldX.length; i++) {
        const joint = joints[i];
        if (joint === undefined) continue;
        joint.x = this.heldX[i] ?? joint.x;
        joint.y = this.heldY[i] ?? joint.y;
      }
    }
  }

  /**
   * Whether `creature` is to be posed from just what it was last time: its joints, its
   * heading, its gait, how it strides, basks, hunches, shakes and tucks its feet. Keeps
   * what it is posed from now for the next time.
   */
  private posedAsBefore(creature: Creature): boolean {
    const { joints } = creature;
    const size = joints.length * 2 + 7;
    let posed = creature.posed;
    let same = posed !== null && posed.length === size;
    if (posed === null || posed.length !== size) posed = creature.posed = new Float64Array(size);
    // (Plain loops, no closures: this runs for every animal in sight every frame.)
    const now = this.posedNow;
    let at = 0;
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      now[at++] = joint?.x ?? 0;
      now[at++] = joint?.y ?? 0;
    }
    now[at++] = creature.heading;
    now[at++] = creature.gait;
    now[at++] = creature.striding;
    now[at++] = creature.basker.share;
    now[at++] = creature.drench.huddle;
    now[at++] = creature.drench.age;
    now[at++] = tuckOf(creature.sleep);
    for (let k = 0; k < size; k++) {
      if (posed[k] !== now[k]) {
        posed[k] = now[k] ?? 0;
        same = false;
      }
    }
    return same;
  }

  /** Only the chest of `creature` breathing, as `pose` has it (the rest stays where it is). */
  private breathe(creature: Creature, dtS: number, widens: number): void {
    const { plan } = creature;
    for (let i = 0; i < plan.parts.length; i++) {
      const part = plan.parts[i];
      const sprite = creature.sprites[i];
      if (part === undefined || sprite === undefined) continue;
      if (part.joint === creature.chest && part.layer > LAYER.ground && part.layer <= LAYER.light) {
        const clock = creature.torpid
          ? this.clock / TORPID_BREATH
          : breathClock(creature.sleep, dtS);
        const full = breath(clock, creature.mass, creature.breathOffset);
        const texels = part.shape === "bar" ? WHITE_TEXELS : DISC_SIZE;
        const deeper = BREATH_WIDENS * breathDepth(creature.sleep);
        sprite.scale.y = (part.across / texels) * (1 + deeper * full) * widens;
      }
    }
  }

  /**
   * Move `creature`'s joints for the drawing as the weather has it (R5, `weather.ts`): a
   * shiver aside down its body as it shakes; its head and neck drawn back, hunched in a
   * storm. Their places are kept to be put back. Returns whether any moved.
   */
  private weathered(creature: Creature): boolean {
    const { joints, plan, drench: state } = creature;
    const shaking = state.age >= 0;
    if (!shaking && state.huddle <= 0) return false;
    for (let i = 0; i < joints.length && i < this.heldX.length; i++) {
      const joint = joints[i];
      if (joint === undefined) continue;
      this.heldX[i] = joint.x;
      this.heldY[i] = joint.y;
    }
    const cos = Math.cos(creature.heading);
    const sin = Math.sin(creature.heading);
    if (state.huddle > 0) {
      const back = HUDDLE_HEAD * plan.spacing * state.huddle;
      const head = joints[0];
      const neck = joints[1];
      if (head !== undefined) {
        head.x -= cos * back;
        head.y -= sin * back;
      }
      if (neck !== undefined && joints.length > 2) {
        neck.x -= (cos * back) / 2;
        neck.y -= (sin * back) / 2;
      }
    }
    if (shaking) {
      for (let i = 0; i < joints.length; i++) {
        const joint = joints[i];
        if (joint === undefined) continue;
        const aside = shiverAt(state.age, i) * (plan.radii[i] ?? 0);
        joint.x -= sin * aside;
        joint.y += cos * aside;
      }
    }
    return true;
  }

  /**
   * Move the gait cycle on: by the distance walked, and while a foot is in the air or out
   * of place at least at a settling pace, so a body that stops still brings its feet in.
   */
  private step(creature: Creature, dtS: number): void {
    // Hunched in a thunderstorm it takes shorter steps, more of them (R5).
    const stride = creature.stride * (1 - HUDDLE_STRIDE * creature.drench.huddle);
    const walked = stride > 0 ? creature.walked / stride : 0;
    creature.walked = 0;
    const settling = creature.unsettled ? dtS / SETTLE_CYCLE_S : 0;
    const advance = Math.min(Math.max(walked, settling), MAX_ADVANCE);
    if (advance > 0) {
      const share = Math.min(1, walked / advance);
      creature.striding += (share - creature.striding) * Math.min(1, dtS * STRIDING_RATE);
    } else {
      creature.striding = 0;
    }
    creature.gait = (creature.gait + advance) % 1;
  }

  private walk(creature: Creature, leg: Leg): void {
    const { joint: at, side, length, thickness, aim } = leg.plan;
    const joint = creature.joints[at];
    if (joint === undefined) return;
    // The body's direction at this joint, and the side the leg is on.
    const forwardX = this.dirX[at] ?? 1;
    const forwardY = this.dirY[at] ?? 0;
    const sideX = -forwardY * side;
    const sideY = forwardX * side;
    // Basking (R5), its body is wider and its legs go straight out to the sides.
    const splay = creature.basker.share;
    const radius = (creature.plan.radii[at] ?? 0) * (1 + BASK_WIDENS * splay);
    const hip = this.hip;
    hip.x = joint.x + sideX * radius * 0.7;
    hip.y = joint.y + sideY * radius * 0.7;
    if (leg.lower === null) {
      // A flipper: it swings about where it is joined, each pair a little after the one in front.
      const swing = Math.sin(creature.stroke - at * 0.9) * STROKE_SWING;
      const rotation =
        (this.angle[at] ?? 0) + side * (Math.PI / 2 + FLIPPER_REST - 0.4 * aim + swing);
      // (Plain loops, no arrays made: this runs for every leg in sight every frame.)
      leg.upper.position.set(hip.x, hip.y);
      leg.upper.rotation = rotation;
      for (let k = 0; k < leg.edges.length; k++) {
        const sprite = leg.edges[k];
        if (sprite === undefined) continue;
        sprite.position.set(hip.x, hip.y);
        sprite.rotation = rotation;
      }
      return;
    }
    // Lying down to sleep (R5), its feet are tucked under it.
    // Hunched in a thunderstorm, its feet are drawn in under it too; basking, they reach out
    // to its sides (R5).
    const tuck =
      tuckOf(creature.sleep) *
      (1 - HUDDLE_TUCK * creature.drench.huddle) *
      (0.8 + (BASK_REACH - 0.8) * splay);
    const splayed = aim * (1 - splay);
    const out = Math.cos(splayed) * length * tuck;
    const ahead = Math.sin(splayed) * length * tuck;
    const restX = hip.x + sideX * out + forwardX * ahead;
    const restY = hip.y + sideY * out + forwardY * ahead;
    // A foot lands ahead of where it rests by half of what the body walks while it
    // stands, so it is as far behind when it lifts again.
    const lead =
      ((1 - SWING_SHARE) *
        creature.stride *
        creature.striding *
        (1 - HUDDLE_STRIDE * creature.drench.huddle)) /
      2;
    const landX = restX + forwardX * lead;
    const landY = restY + forwardY * lead;
    if (!leg.planted || Math.hypot(leg.foot.x - restX, leg.foot.y - restY) > length * SNAP_LEGS) {
      leg.foot.x = restX;
      leg.foot.y = restY;
      leg.planted = true;
      leg.swinging = false;
    }
    // Its own part of the cycle: the foot swings from where it lifted to where it lands
    // (which moves on with the body), then stands where it landed until its turn comes again.
    const into = (creature.gait - leg.phase + 1) % 1;
    const swinging = into < SWING_SHARE;
    let raised = 0;
    if (swinging) {
      if (!leg.swinging) {
        leg.lift.x = leg.foot.x;
        leg.lift.y = leg.foot.y;
      }
      const t = into / SWING_SHARE;
      const eased = t * t * (3 - 2 * t);
      leg.target.x = landX;
      leg.target.y = landY;
      leg.foot.x = leg.lift.x + (landX - leg.lift.x) * eased;
      leg.foot.y = leg.lift.y + (landY - leg.lift.y) * eased;
      raised = Math.sin(Math.PI * t) * FOOT_LIFT * length * LIGHT;
      creature.unsettled = true;
    } else if (leg.swinging) {
      // Down where it was going, firmly: it does not slide while it stands.
      leg.foot.x = leg.target.x;
      leg.foot.y = leg.target.y;
      // Hurrying on dry ground, its hind feet kick up a little dust behind it (R5).
      const hind = this.hindmost(creature, leg);
      if (creature.hurried && hind) this.footfall?.(leg.foot.x, leg.foot.y);
    }
    leg.swinging = swinging;
    if (Math.hypot(leg.foot.x - landX, leg.foot.y - landY) > length * SETTLE_OFF) {
      creature.unsettled = true;
    }
    // A foot in the air is drawn lifted toward the light; where it stands is unchanged.
    const foot = this.foot;
    foot.x = leg.foot.x - raised;
    foot.y = leg.foot.y - raised;

    const bone = length * 0.6;
    solveKnee(hip, foot, bone, bone, side, this.knee);
    this.stretch(leg.upper, hip, this.knee, thickness);
    this.stretch(leg.lower, this.knee, foot, thickness * 0.8);
    const upperEdge = leg.edges[0];
    const lowerEdge = leg.edges[1];
    const soleEdge = leg.edges[2];
    const edge = 2 * leg.plan.edge;
    if (upperEdge !== undefined) this.stretch(upperEdge, hip, this.knee, thickness + edge);
    if (lowerEdge !== undefined) this.stretch(lowerEdge, this.knee, foot, thickness * 0.8 + edge);
    // A webbed foot lies ahead of the leg's end, across the way the shin points.
    const reach = leg.webbed ? leg.plan.foot * WEB_AHEAD : 0;
    const shin = Math.atan2(foot.y - this.knee.y, foot.x - this.knee.x);
    for (let k = 0; k < 2; k++) {
      const sprite = k === 0 ? soleEdge : leg.sole;
      if (sprite === undefined || sprite === null) continue;
      sprite.position.set(foot.x + Math.cos(shin) * reach, foot.y + Math.sin(shin) * reach);
      if (leg.webbed) sprite.rotation = shin;
    }
  }

  /** Whether `leg` is of the hindmost pair of `creature`'s legs. */
  private hindmost(creature: Creature, leg: Leg): boolean {
    const last = creature.legs[creature.legs.length - 1];
    return last !== undefined && leg.plan.joint === last.plan.joint;
  }

  /** Stretch a white square from `from` to `to`. */
  private stretch(sprite: Sprite, from: Point, to: Point, thickness: number): void {
    sprite.position.set(from.x, from.y);
    sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    sprite.scale.set(
      Math.hypot(to.x - from.x, to.y - from.y) / WHITE_TEXELS,
      thickness / WHITE_TEXELS,
    );
  }
}

/** Whether `joints` stand where `kept` (x, y after x, y) says they stood. */
function sameJoints(kept: Float64Array, joints: readonly Point[]): boolean {
  if (kept.length !== joints.length * 2) return false;
  for (let i = 0; i < joints.length; i++) {
    const joint = joints[i] as Point;
    if (kept[2 * i] !== joint.x || kept[2 * i + 1] !== joint.y) return false;
  }
  return true;
}

let skirmishSparks: SparkKind | null = null;

/** A face-off's spark: a plus that shrinks to a dot (the pack mod). */
function skirmishKind(): SparkKind {
  skirmishSparks ??= {
    frames: [pixelTexture([".#.", "###", ".#."]), pixelTexture(["#"])],
    lasts: SKIRMISH_S,
    fadesAt: 0.6,
  };
  return skirmishSparks;
}

/** Which of the `NEST_LOOKS` layouts a species' nests have (a hash of its id). */
function nestLook(species: number): number {
  const hash = Math.imul(species ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  return (hash >>> 7) % NEST_LOOKS;
}

const nestLooks = new Map<number, { twigs: Texture; stones: Texture }>();

/**
 * A nest's drawing in layout `look`: each texel of `NEST_SHAPE` a twig or a stone, as the
 * layout's bits say, about one in three a stone; drawn in white, tinted by the caller.
 */
function nestTextures(look: number): { twigs: Texture; stones: Texture } {
  let textures = nestLooks.get(look);
  if (textures === undefined) {
    let bits = Math.imul(look + 1, 0x9e3779b1) >>> 0;
    const twigs: string[] = [];
    const stones: string[] = [];
    for (const row of NEST_SHAPE) {
      let twig = "";
      let stone = "";
      for (const texel of row) {
        bits = (Math.imul(bits ^ (bits >>> 15), 0x2c1b3c6d) + 1) >>> 0;
        const isStone = texel === "#" && bits % 3 === 0;
        twig += texel === "#" && !isStone ? "#" : ".";
        stone += isStone ? "#" : ".";
      }
      twigs.push(twig);
      stones.push(stone);
    }
    textures = { twigs: pixelTexture(twigs), stones: pixelTexture(stones) };
    nestLooks.set(look, textures);
  }
  return textures;
}
