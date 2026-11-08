/**
 * The atmosphere over the scene (R4, ADR 0021): the light, what glows in the dark, the
 * weather of the island's events, and the end of a world.
 *
 *   light     the colour multiplied over everything (`light.ts`): moonlit blue at night,
 *             rose at dusk, lilac at dawn, day graded by the season, greyed by rain;
 *             eased between the sim's 10-minute steps
 *   glow      light added over the tint, so that it shows in the dark: the spots of
 *             animals with the glow gene, fires, lava, sparks, beams
 *   weather   rain while the rain god power's rain falls; smoke over burning cells; ash
 *             and lava from a volcano; a shake and dust for an earthquake; a meteor's
 *             streak, flash and dust where it digs its crater; light from the sky where
 *             the seed and ark powers fall; a flash when lightning starts a fire
 *   the end   the apocalypse sequence (`apocalypse.ts`), about three minutes on the map
 *
 * Its layers go in the scene in this order: the world (land, plants, animals) and then
 * `ground` (cells: the risen sea, smoke, dust), `weather` (art pixels of the screen: rain,
 * falling ash), `tint` (the light, multiplied over all of those), `lights` (cells, added
 * over the tint) and `flash` (the screen, over everything). The scroll and the dip
 * between views are page elements and take none of it.
 *
 * Short things (a shake, a meteor, a beam) last a few wall seconds, so that they read at
 * any speed; a volcano's eruption lasts sim-hours, and at least some wall seconds.
 */
import { ColorMatrixFilter, Container, Sprite, Texture } from "pixi.js";
import { GLOW_SPOT } from "../creatures/body";
import type { ViewName } from "../landscape";
import type { EventsMessage, Message, Season, SkyMessage } from "../protocol";
import { mulberry32, type Random } from "../rng";
import type { CellRect, Land } from "../terrain/land";
import { cellHash } from "../terrain/pixels";
import { Sequence, floodPixels, seaLevelAt, ventsOf, type Moment } from "./apocalypse";
import {
  LightEase,
  RAIN_GREY,
  darkness,
  mixRgb,
  multiplyRgb,
  packRgb,
  skyTint,
  type Rgb,
} from "./light";
import { BOLTS, boltAt, boltPath, strikePoint } from "./lightning";
import {
  CRATER_RIM,
  LAVA_FRAMES,
  coneSummit,
  craterOnLand,
  dustTexture,
  markTexture,
} from "./marks";
import { seaAt } from "../terrain/sea";
import {
  RowPool,
  SpritePool,
  dropAt,
  placeCentred,
  puffAt,
  tint,
  type Fall,
  type Plume,
  type Puff,
  type Rows,
} from "./particles";
import {
  HALO_SIZE,
  RINGS,
  SPROUT_FRAMES,
  atmosphereSprites,
  emberTextures,
  sproutTextures,
  streakTexture,
  type Sprites,
} from "./sprites";
import { VISIBLE_FROM } from "../plants/look";
import { windStrength, type Wind } from "../plants/wind";
import { FADE_S } from "../terrain/grounds";
import { isChristmasActive } from "../mods/builtin/christmas";

/** The colours of things that glow (0xRRGGBB): lava and fire, sparks, the seed's gold, the ark's light. */
const LAVA = [0xff5a1e, 0xff8a2a, 0xffc04a] as const;
const FIRE = [0xff7a20, 0xffa830, 0xffd060] as const;
const SPARK = 0xffe6a0;
const SEED_GOLD = 0xffe08a;
const ARK_LIGHT = 0xd8f0ff;
/** Smoke, ash, dust and rain (0xRRGGBB). */
const SMOKE = 0x8a8290;
const ASH = 0x3c3438;
const DUST = 0xb8a088;
/** Rain, far to near: a pale, cool blue that shows on grass, sand and water alike. */
const RAIN_TONES = [0xa4c2e2, 0xbcd6f2, 0xdcebfc] as const;
const RIPPLE = 0xe8f4ff;
const BOLT = 0xf4f8ff;
const BOLT_GLOW = 0xb8d0ff;
/** How hard each rain falls (share of `RAINDROPS`), and how it leans (art pixels a second across). */
const RAIN_STRENGTH: Readonly<Record<RainKind, number>> = {
  none: 0,
  rain: 0.7,
  thunder: 0.8,
  storm: 1.5,
  soaking: 0.6,
  cloud: 0,
};
/**
 * How overcast the sky is under each weather (0–1): it greys the light and lays a veil of
 * cloud-grey over the land, which takes the colour out of it as a blocked sun does.
 */
const OVERCAST: Readonly<Record<RainKind, number>> = {
  none: 0,
  cloud: 0.5,
  soaking: 0.75,
  rain: 0.8,
  thunder: 0.9,
  storm: 1,
};
/** The veil at full overcast: its colour and opacity (a haze of cloud over the land). */
const VEIL = 0x9aa2ac;
const VEIL_ALPHA = 0.14;
/**
 * The sun behind cloud takes the colour out of the land: at full overcast this share of
 * each colour goes to its grey (a cloudy sky half that), with a cool cast (per channel).
 */
const GREY_OUT = 0.72;
const CLOUD_CAST: Rgb = [0.96, 0.99, 1.05];
/** How much the rain leans with the wind: pixels across for each pixel down. */
const RAIN_LEAN: Readonly<Record<RainKind, number>> = {
  none: 0,
  rain: 0.35,
  thunder: 0.45,
  storm: 1,
  soaking: 0.2,
  cloud: 0,
};
/** Rain as the view is close: how long a drop is (art pixels), how fast it falls (art pixels a second), how many, how bright. */
const RAIN_SCALE: Readonly<
  Record<ViewName, { length: number; speed: number; count: number; alpha: number }>
> = {
  map: { length: 4, speed: 170, count: 1.6, alpha: 0.9 },
  middle: { length: 5, speed: 210, count: 1.3, alpha: 0.9 },
  local: { length: 6, speed: 230, count: 1, alpha: 0.85 },
};
/** The layers of rain, far to near: share of the drops, and how fast, long and bright against the view's. */
const RAIN_LAYERS = [
  { share: 0.45, speed: 0.6, length: 0.6, alpha: 0.55 },
  { share: 0.35, speed: 1, length: 1, alpha: 0.85 },
  { share: 0.2, speed: 1.45, length: 1.45, alpha: 1 },
] as const;
/**
 * How hard a spell of rain falls, as a share of its kind's strength: each spell draws its
 * own (from when it began), and within it the rain comes and goes over `RAIN_SWELL_S`.
 */
const RAIN_POWER: readonly [number, number] = [0.45, 1.35];
const RAIN_SWELL_S = 18;
/** Frames a second the screen shows (the board's, R0): what a raindrop falls in one. */
const FRAME_RATE = 30;
/**
 * Snow (round 6): it falls where snow lies at least this deep (0–255, as the sim has it),
 * this many flakes at full fall, this fast (art pixels a second), swaying this far (art
 * pixels), this large in each view (art pixels), in three layers far to near.
 */
const SNOW_FALLS_FROM = 40;
/**
 * A view's whole fall is snow when at least this share of its land has snow lying, rain
 * otherwise: one kind at a time (round 7, the owner: rain and snow mixed looked wrong where
 * snow lies in patches). The two cross-fade as the share crosses it.
 */
const SNOW_VIEW_SHARE = 0.5;
const SNOWFLAKES = 480;
const SNOW_SPEED = 28;
const SNOW_SWAY = 3;
const SNOW_SIZE: Readonly<Record<ViewName, number>> = { map: 1, middle: 1.5, local: 2.5 };
const SNOW_LAYERS = [
  { share: 0.45, speed: 0.6, size: 0.7, alpha: 0.6 },
  { share: 0.35, speed: 1, size: 1, alpha: 0.85 },
  { share: 0.2, speed: 1.5, size: 1.5, alpha: 1 },
] as const;
const SNOW_TONES = [0xc8d4e4, 0xe4ecf6, 0xffffff] as const;
/**
 * The Christmas mod (`mods/builtin/christmas.ts`): the least fall it keeps going (as
 * `rain`, all of it snow); the fairy lights' colours, the share of trees and bushes that
 * carry them, how many at most are drawn, how fast they twinkle (radians a second) and
 * how bright by day and at full dark; the winter star's place on the screen (shares of
 * its width and height), its colours, and the dark it begins to show from and is full at.
 */
const YULE_SNOW = 0.75;
const FAIRY_COLOURS = [0xff3b3b, 0xffc93c, 0x4cd964, 0x4de1ff] as const;
const FAIRY_SHARE = 0.4;
const MOST_FAIRY_LIGHTS = 240;
const FAIRY_TWINKLE = 4;
const FAIRY_DAY = 0.35;
const FAIRY_NIGHT = 1;
const FAIRY_FORMS: readonly string[] = ["SHRUB", "BROADLEAF", "CONIFER"];
const STAR_AT = { x: 0.82, y: 0.12 } as const;
const STAR_CORE = 0xffffff;
const STAR_ARMS = 0xffe27a;
const STAR_FROM = 0.3;
const STAR_FULL = 0.6;
/** Glow: seconds a pulse takes, and the glow round an animal's square on the map (art pixels). */
const GLOW_PULSE_S = 3.5;
const GLOW_MAP_PX = 8;
/**
 * The glow's opacity at the bottom and top of its pulse in each view, at full dark. Closer
 * in its rings overlap along the back, so they are fainter: the animal must show through.
 */
const GLOW_RANGE: Readonly<Record<ViewName, readonly [number, number]>> = {
  map: [0.3, 0.7],
  middle: [0.12, 0.3],
  local: [0.06, 0.16],
};
/** A thunderstorm darkens the sky this much more than rain (multiplied in as it builds). */
const STORM_GREY: Rgb = [0.6, 0.64, 0.78];
/** Ripples on the water a frame at full rain, in the middle and local views, and how long one lasts (s). */
const RIPPLES = 40;
const RIPPLE_S = 0.6;
/** The sky at the end of a world. */
const BLOOD_RED: Rgb = [1.0, 0.42, 0.3];

/** Wall seconds each short thing lasts; a volcano lasts sim-hours, at least `VOLCANO_WALL_S`. */
const QUAKE_S = 4;
const METEOR_FALL_S = 1.2;
const METEOR_S = 7;
/**
 * How large a meteor's streak is drawn in each view, and how far it comes from (times its
 * size on the map; round 7, the owner: it read too small in the middle view).
 */
const METEOR_SIZE: Readonly<Record<ViewName, number>> = { map: 1, middle: 1.8, local: 1 };
const BEAM_S = 8;
/**
 * The ark's newcomers: how long each takes to come into being (wall seconds), and how far
 * from the ark's light (cells) and how long after it (wall seconds) an animal new to the
 * scene counts as one of them rather than as born.
 */
const ARRIVE_S = 2.5;
const ARK_REACH = 20;
const ARK_LATE_S = BEAM_S + 4;
/**
 * The seed's sprouts: land that had less biomass than this (0–255) and has some after the
 * seed is sown; they grow over this many wall seconds, each starting up to so many seconds
 * after the land comes, and are drawn until the plants show or so many sim-days pass. The
 * sown land is looked for this many wall seconds after the power.
 */
const SOWN_BARE = 10;
const SPROUT_GROW_S = 3;
const SPROUT_STAGGER_S = 2.5;
const SPROUT_DAYS = 20;
const SOWING_WAIT_S = 60;
/**
 * A volcano's cone and a meteor's crater stay drawn this many sim-days after (the land
 * keeps them; its shading barely shows them), and at least this many wall seconds.
 */
const MARK_DAYS = 30;
const MARK_WALL_S = 90;
/** Sim time over which a cone or crater fades as its days end. */
const MARK_FADE_MS = 2 * 86_400_000;
/** Wall seconds a new cone takes to rise out of the ground. */
const CONE_RISE_S = 2.5;
/**
 * The dust over a new cone or crater: seconds it lasts, rises in and thins away (it covers
 * the plants' fade, `FADE_S`), and its puffs.
 */
const BILLOW_S = 3.6;
const BILLOW_IN_S = 0.8;
const BILLOW_OUT_S = 1;
const BILLOW_PUFFS = 40;
const BILLOW_CLOUDS = 6;
/** How far (radii) a cone and a crater clear what stands round them. */
const COVER_CONE = 1.4;
const COVER_CRATER = 1.4;
const MS_PER_DAY = 86_400_000;
/** Seconds a burnt animal's ash rises; motes of the seed power over the bare land in sight. */
const ASH_S = 3;
/** Frames a second of the lava's flow (it loops over `LAVA_FRAMES`). */
const LAVA_FPS = 4;
/** Up close: frames a second of the big flame's flicker, its opacity, and the small flames round it per cell. */
const FLAME_FPS_CLOSE = 4;
const FLAME_ALPHA_CLOSE = 0.72;
const SMALL_FLAMES = 3;
/** Wall seconds a cell's fire takes to come up as it catches, and to die down as it goes out. */
const FLAME_IN_S = 0.8;
const FLAME_OUT_S = 1.5;

/** How much bigger a light about a place is drawn the closer the view (art pixels per map's). */
function closeness(tile: number): number {
  return tile >= 32 ? 4 : tile >= 8 ? 2 : 1;
}
const SEED_MOTES = 120;
const SPARKS_S = 2;
const VOLCANO_HOURS = 12;
const VOLCANO_WALL_S = 30;
const FLASH_S = 0.5;
/** Art pixels a quake shakes the picture by, at most; a meteor's landing, a little less. */
const QUAKE_PX = 2;
const IMPACT_PX = 2;
/** At most this many burning cells lit, and this many of them smoking. */
const MOST_FIRES = 300;
const MOST_SMOKES = 24;
/** Raindrops and flecks of falling ash on the screen at full strength. */
const RAINDROPS = 180;
const ASHFALL = 90;
/** Seconds for rain to set in or stop. */
const RAIN_EASE_S = 3;
/** Lava vents of the end of a world. */
const VENTS = 40;
/** Seconds between repaints of the risen sea (it moves slowly). */
const FLOOD_REPAINT_S = 0.1;
const MS_PER_HOUR = 3_600_000;

/** Something that glows on an animal (cells): where, and how big the animal is. */
export interface Spot {
  x: number;
  y: number;
  size: number;
}

/** What the scene shows this frame. */
export interface View {
  view: ViewName;
  cells: CellRect;
  /** Art pixels to the cell. */
  tile: number;
  /** The screen, in art pixels. */
  width: number;
  height: number;
  land: Land | null;
  /** Glowing animals in sight. */
  glowing: readonly Spot[];
  /** Art pixels of screen beyond the world's first cell in sight (the canvas's margin). */
  margin?: number;
  /** The plants' rows of the view, to sort what stands among them; none on the map. */
  rows?: Rows | null;
}

type Kind =
  | "volcano"
  | "quake"
  | "meteor"
  | "seed"
  | "ark"
  | "arrival"
  | "sparks"
  | "strike"
  | "ash"
  | "cone"
  | "crater"
  | "billow";
/** What falls from the sky (the `sky` message's `rain`). */
export type RainKind = SkyMessage["rain"];

interface Effect {
  kind: Kind;
  x: number;
  y: number;
  radius: number;
  /** Wall seconds since it began, and the least it lasts. */
  age: number;
  wallS: number;
  /** Sim time it lasts to (volcano), or -1. */
  untilMs: number;
  salt: number;
  /** Whether a meteor has struck yet (its flash goes off once). */
  struck: boolean;
  /** Wall seconds before it shows (a crater waits for its meteor). */
  delayS?: number;
}

export interface AtmosphereOptions {
  /** Called when a world's end begins on the screen (the camera goes to the map, the dead go). */
  onEnd?: () => void;
  /** The shake's random draws. */
  random: Random;
}

export class Atmosphere {
  readonly ground = new Container();
  readonly weather = new Container();
  readonly tint: Sprite;
  /** Cloud-grey laid over the land, under the tint, as the sky is overcast. */
  readonly veil: Sprite;
  /**
   * The colour grade of the world under cloud: put on the world's container while the sky
   * is overcast (`graded`), and nothing otherwise, so a clear day costs no filter pass.
   */
  /** The cloud the grade's matrix was last built for (`setGrade`). */
  private gradedFor = Number.NaN;
  readonly grade = new ColorMatrixFilter();
  readonly lights = new Container();
  readonly flash: Sprite;
  /** Over everything, on the screen: lightning, and the flash. */
  readonly sky = new Container();

  private readonly sprites: Sprites = atmosphereSprites();
  private readonly groundPool = new SpritePool("normal");
  /** What lies on the ground, under the plants (`Landscape.floor`). */
  readonly floor = new Container();
  private readonly floorPool = new SpritePool("normal");
  /** What stands among the plants: flames, a cone and its lava, sprouts. */
  private readonly standPool: RowPool;
  private readonly weatherPool = new SpritePool("normal");
  private readonly lightPool = new SpritePool("add");
  /** The fire's cells in sight, its plumes and a puff, kept from frame to frame (no garbage). */
  private readonly inSight: number[] = [];
  private readonly plumes = { flames: newPlume(), sparks: newPlume(), smoke: newPlume() };
  private readonly puff: Puff = { x: 0, y: 0, size: 0, alpha: 0 };
  /** Flames and a volcano's mouth: drawn as they are, over the tint (they make their own light). */
  private readonly ripplePool = new SpritePool("normal");
  private readonly boltPool = new SpritePool("add");
  private readonly flood: Sprite;
  private floodCanvas: HTMLCanvasElement | null = null;
  private floodTexture: Texture | null = null;
  private floodLevel: number | null = null;
  private floodWait = 0;

  private readonly ease = new LightEase(1);
  private present = true;
  private rainKind: RainKind = "none";
  private rain = 0;
  private storm = 0;
  private overcast = 0;
  /** How dark it was at the last update (0–1): the wind drops a little at night. */
  private dark = 0;
  /** How much of the fall is snow, 0–1, eased; and the view's snowy share, kept per land and view. */
  private snowfall = 0;
  private snowShare: { land: Land; key: string; share: number } | null = null;
  /** When each cell's fire came up and went out (scene seconds), while it shows. */
  private readonly flameLife = new Map<number, { born: number; died: number | null }>();
  private burningSeen: readonly number[] = [];
  /** The land of a meteor's crater, held until it strikes (scene seconds). */
  private heldLand: Message | null = null;
  private landHeldUntilS = -Infinity;
  /** This spell's own strength (`RAIN_POWER`), drawn as it begins. */
  private rainPower = 1;
  private burning: readonly number[] = [];
  private season: Season = "summer";
  private progress = 0.5;
  private simMs = 0;
  /** The seed power, waiting for the land it sows (scene seconds it came). */
  private sowing: { since: number; seen?: Land } | null = null;
  /** The land drawn now, the one before it, and when (scene seconds) it changed. */
  private landNow: Land | null = null;
  private landBefore: Land | null = null;
  private landChangedS = -Infinity;
  /** The cells it sowed, and when (scene seconds) their sprouts begin; drawn until `sownUntilMs`. */
  private sown: { cell: number; at: number; gone?: number }[] = [];
  private sownUntilMs = 0;
  private timeS = 0;
  private flashLeft = 0;
  private effects: Effect[] = [];
  private salts = 0;
  private readonly sequence: Sequence;
  private vents: { x: number; y: number }[] = [];
  private shown: Rgb = [1, 1, 1];

  constructor(
    private readonly deliver: (message: Message) => void,
    private readonly options: AtmosphereOptions,
  ) {
    this.tint = new Sprite({ texture: Texture.WHITE, blendMode: "multiply" });
    this.veil = new Sprite(Texture.WHITE);
    this.veil.tint = VEIL;
    this.veil.alpha = 0;
    this.flash = new Sprite(Texture.WHITE);
    this.flash.alpha = 0;
    this.flood = new Sprite(Texture.EMPTY);
    this.flood.visible = false;
    this.ground.addChild(this.flood, this.ripplePool.container, this.groundPool.container);
    this.floor.addChild(this.floorPool.container);
    this.standPool = new RowPool(this.ground);
    this.weather.addChild(this.weatherPool.container);
    this.lights.addChild(this.lightPool.container);
    this.sky.addChild(this.boltPool.container, this.flash);
    this.sequence = new Sequence(deliver);
  }

  /**
   * Take `message` before anything else does: true when a world's end holds it back (it
   * is handed to `deliver` later). The message that ends a world starts the sequence.
   */
  hold(message: Message): boolean {
    const was = this.sequence.active;
    const held = this.sequence.take(message);
    if (!was && this.sequence.active) this.options.onEnd?.();
    if (held) return true;
    // A meteor's crater: the land that comes with it (just after its news) waits until the
    // meteor has struck, so that the bowl does not show before it.
    if (message.type === "events" && message.events.some((event) => event.kind === "crater")) {
      this.landHeldUntilS = this.timeS + METEOR_FALL_S;
    }
    if (message.type === "land" && this.timeS < this.landHeldUntilS) {
      this.heldLand = message;
      return true;
    }
    return false;
  }

  /** Hand on the land held for a meteor once it has struck. */
  private releaseLand(): void {
    if (this.heldLand === null || this.timeS < this.landHeldUntilS) return;
    const land = this.heldLand;
    this.heldLand = null;
    this.deliver(land);
  }

  /** Whether a world is ending on the screen (the camera stays on the map). */
  get ending(): boolean {
    return this.sequence.active;
  }

  /** Take a message as it reaches the scene. */
  receive(message: Message): void {
    if (message.type === "clock") {
      this.simMs = message.t_ms;
      this.season = message.season;
      this.progress = message.season_progress;
    } else if (message.type === "sky") {
      this.simMs = message.t_ms;
      this.ease.step(message.light);
      this.present = message.present;
      if (message.rain !== this.rainKind && message.rain !== "none") {
        const [weakest, strongest] = RAIN_POWER;
        const hour = Math.floor(message.t_ms / 3_600_000);
        this.rainPower = weakest + (strongest - weakest) * cellHash(hour, 0, 431);
      }
      this.rainKind = message.rain;
      this.burning = message.burning;
    } else if (message.type === "events") this.takeEvents(message);
  }

  /** Show the sky's light at once (a picture that must not wait for the ease). */
  settleLight(): void {
    this.ease.set(this.ease.target);
    this.rain = RAIN_STRENGTH[this.rainKind];
    this.storm = this.rainKind === "storm" ? 1 : 0;
    this.overcast = OVERCAST[this.rainKind];
  }

  private takeEvents(message: EventsMessage): void {
    for (const event of message.events) {
      const x = event.x ?? 0;
      const y = event.y ?? 0;
      const radius = event.radius_cells ?? 2;
      const add = (kind: Kind, wallS: number, untilMs = -1, delayS = 0): void => {
        this.effects.push({
          kind,
          x,
          y,
          radius,
          age: 0,
          wallS,
          untilMs,
          salt: ++this.salts,
          struck: false,
          delayS,
        });
      };
      switch (event.kind) {
        case "volcano":
          add("cone", MARK_WALL_S, event.t_ms + MARK_DAYS * MS_PER_DAY);
          add("volcano", VOLCANO_WALL_S, event.t_ms + VOLCANO_HOURS * MS_PER_HOUR);
          add("billow", BILLOW_S);
          break;
        case "earthquake":
          add("quake", QUAKE_S);
          break;
        case "crater":
          // A meteor's god power digs it: its fall is drawn here, where it lands, and the
          // bowl it leaves once it has struck.
          add("crater", MARK_WALL_S, event.t_ms + MARK_DAYS * MS_PER_DAY, METEOR_FALL_S);
          add("billow", BILLOW_S + METEOR_FALL_S, -1, METEOR_FALL_S);
          add("meteor", METEOR_S);
          break;
        case "god_power":
          if (event.power === "seed") {
            add("seed", BEAM_S);
            this.sowing = { since: this.timeS };
          } else if (event.power === "ark") add("ark", BEAM_S);
          break;
        case "creatures_arrived": {
          // The ark's newcomers land here: its light goes where they are.
          const ark = [...this.effects]
            .reverse()
            .find((effect) => effect.kind === "ark" && effect.age === 0);
          if (ark !== undefined) {
            ark.x = x;
            ark.y = y;
          }
          break;
        }
        case "fire_started":
          // The thunderstorm's lightning: the biggest bolt, where the fire begins.
          add("strike", BOLTS.strike.lasts + SPARKS_S);
          add("sparks", SPARKS_S);
          break;
        case "world_ended":
          this.effects = [];
          this.burning = [];
          this.sown = [];
          this.sowing = null;
          break;
        default:
          break;
      }
    }
  }

  /** Move everything on by `dtS` wall seconds and draw it for `view`; the shake to apply (art pixels). */
  update(dtS: number, view: View): { x: number; y: number } {
    this.timeS += dtS;
    this.releaseLand();
    this.ease.tick(dtS);
    this.flashLeft = Math.max(this.flashLeft - dtS, 0);
    const ease = (now: number, target: number): number =>
      now + Math.sign(target - now) * Math.min(Math.abs(target - now), dtS / RAIN_EASE_S);
    // The spell's strength, swelling and easing within it (a storm stays heavy).
    const swell = 0.5 + 0.5 * Math.sin((2 * Math.PI * this.timeS) / RAIN_SWELL_S);
    const power =
      this.rainKind === "storm"
        ? Math.max(this.rainPower, 1) * (0.85 + 0.3 * swell)
        : this.rainPower * (0.7 + 0.6 * swell);
    this.rain = ease(this.rain, RAIN_STRENGTH[this.rainKind] * power);
    this.storm = ease(this.storm, this.rainKind === "storm" ? 1 : 0);
    this.overcast = ease(this.overcast, OVERCAST[this.rainKind]);
    const snowing = this.snowyShare(view) >= SNOW_VIEW_SHARE ? 1 : 0;
    // While nothing falls the kind changes at once; while it falls, rain turns to snow slowly.
    this.snowfall = this.rain <= 0.01 ? snowing : ease(this.snowfall, snowing);
    // The holidays (the Christmas mod): snow falls whatever the season and the sky.
    const yule = isChristmasActive();
    if (yule) {
      this.snowfall = 1;
      this.rain = Math.max(this.rain, YULE_SNOW);
    }
    const wasEnding = this.sequence.active;
    this.sequence.update(dtS);
    const moment = this.sequence.active ? this.sequence.moment : null;
    if (moment !== null && (!wasEnding || this.vents.length === 0) && view.land !== null) {
      this.vents = ventsOf(view.land, VENTS, mulberry32(view.land.width * 7919 + view.land.height));
    }
    if (moment === null) this.vents = [];
    for (const effect of this.effects) effect.age += dtS;
    this.effects = this.effects.filter(
      (effect) => effect.age < effect.wallS || (effect.untilMs >= 0 && this.simMs < effect.untilMs),
    );

    this.paintTint(view, moment);
    this.groundPool.begin();
    this.floorPool.begin();
    this.standPool.begin();
    this.weatherPool.begin();
    this.lightPool.begin();
    this.ripplePool.begin();
    this.boltPool.begin();
    let shake = 0;
    const dark = this.darkness(moment);
    this.dark = dark;
    this.watchSowing(view.land);
    this.drawSprouts(view);
    this.drawGlow(view, dark);
    this.drawFires(view, dark);
    for (const effect of this.effects) shake = Math.max(shake, this.drawEffect(effect, view));
    this.drawRain(view);
    this.drawSnow(view);
    if (yule) {
      this.drawFairyLights(view, dark);
      this.drawWinterStar(view, dark);
    }
    const lightning = this.drawLightning(view);
    if (moment !== null) shake = Math.max(shake, this.drawEnd(moment, view, dtS));
    else this.flood.visible = false;
    this.groundPool.end();
    this.floorPool.end();
    this.standPool.end();
    this.weatherPool.end();
    this.lightPool.end();
    this.ripplePool.end();
    this.boltPool.end();

    this.flash.width = view.width;
    this.flash.height = view.height;
    this.flash.alpha = Math.max(Math.min(this.flashLeft / FLASH_S, 1) * 0.8, lightning);
    if (shake <= 0 || dtS <= 0) return { x: 0, y: 0 };
    const jolt = (): number => Math.round((this.options.random() * 2 - 1) * shake);
    return { x: jolt(), y: jolt() };
  }

  /**
   * The wind the plants lean in (R5, `plants/wind.ts`): on the atmosphere's clock, as hard
   * as the rain and a thunderstorm make it, a little calmer at night.
   */
  get wind(): Wind {
    return { timeS: this.timeS, strength: windStrength(this.rain, this.storm, this.dark) };
  }

  /** How overcast the sky is now (0–1, eased): R5's photosynthesisers bask only under a clear one. */
  get overcastNow(): number {
    return this.overcast;
  }

  /** How dark it is (0–1): the night's, or the end of a world's. */
  private darkness(moment: Moment | null): number {
    const night = darkness(this.ease.value);
    return moment === null ? night : Math.max(night, moment.black, moment.red * 0.6);
  }

  private paintTint(view: View, moment: Moment | null): void {
    let colour = skyTint(this.ease.value, this.present, this.season, this.progress);
    // Clouds over the sun: the light greys and dims, and a veil of cloud-grey takes the
    // colour out of the land; a storm darker still.
    colour = multiplyRgb(colour, mixRgb([1, 1, 1], RAIN_GREY, this.overcast));
    colour = multiplyRgb(colour, mixRgb([1, 1, 1], STORM_GREY, this.storm));
    // The veil is cloud lit by the day: grey by day, dark at night, none in the end of a world.
    const lit = Math.max(...colour);
    this.veil.alpha = moment === null ? VEIL_ALPHA * this.overcast * lit : 0;
    this.setGrade(moment === null ? this.overcast : 0);
    // The rain is drawn over the tint, so that it shows on any ground: as bright as the
    // light it falls in.
    this.weather.alpha = 0.3 + 0.7 * Math.min(lit / 0.8, 1);
    this.veil.width = view.width;
    this.veil.height = view.height;
    if (moment !== null) {
      // Red whatever the hour: the end of a world is lit by its fires, not by the owner.
      colour = mixRgb(colour, BLOOD_RED, moment.red);
      colour = mixRgb(colour, [0.03, 0.02, 0.04], moment.black);
    }
    this.shown = colour;
    this.tint.tint = packRgb(colour);
    this.tint.width = view.width;
    this.tint.height = view.height;
  }

  /** Grey the world's colours by `overcast` (0–1): toward their luminance, cooled a little. */
  private setGrade(overcast: number): void {
    // Built again only when the cloud has changed (R5: it was rebuilt every frame).
    if (overcast === this.gradedFor) return;
    this.gradedFor = overcast;
    const k = GREY_OUT * overcast;
    const cast = mixRgb([1, 1, 1], CLOUD_CAST, overcast);
    const luma = [0.299, 0.587, 0.114];
    const row = (channel: number): number[] => [
      ...luma.map((weight, i) => (cast[channel] ?? 1) * (k * weight + (i === channel ? 1 - k : 0))),
      0,
      0,
    ];
    this.grade.matrix = [
      ...row(0),
      ...row(1),
      ...row(2),
      0,
      0,
      0,
      1,
      0,
    ] as unknown as typeof this.grade.matrix;
  }

  /** Whether the world is to be graded now (the sky overcast). */
  get graded(): boolean {
    return this.overcast > 0.01 && !this.sequence.active;
  }

  private halo(
    x: number,
    y: number,
    size: number,
    colour: number,
    alpha: number,
    tile: number,
  ): void {
    if (alpha <= 0.01) {
      this.lightPool.skip();
      return;
    }
    const sprite = this.lightPool.next(this.sprites.halo);
    // No bigger than the texture thrice, so that its steps stay a few art pixels wide.
    placeCentred(sprite, x, y, tile, Math.min(size, 3 * HALO_SIZE));
    tint(sprite, colour);
    sprite.alpha = Math.min(alpha, 1);
  }

  /** A flicker between 0.75 and 1 for thing `n`, changing a few times a second. */
  private flicker(n: number): number {
    return 0.75 + 0.25 * cellHash(n, Math.floor(this.timeS * 6), 341);
  }

  private drawGlow(view: View, dark: number): void {
    if (dark <= 0.02) return;
    // A slow pulse, a breath every few seconds.
    const pulse = 0.5 + 0.5 * Math.sin((2 * Math.PI * this.timeS) / GLOW_PULSE_S);
    const [low, high] = GLOW_RANGE[view.view];
    const strength = dark * (low + (high - low) * pulse);
    const map = view.view === "map";
    for (const spot of view.glowing) {
      // On the map a soft light just round the animal's square; closer, a ring of light
      // round each spot of its back, its heart clear so that the animal shows through.
      const size = map
        ? GLOW_MAP_PX
        : Math.max(spot.size * view.tile * (view.tile >= 32 ? 7 : 5), 12);
      const sprite = this.lightPool.next(map ? this.sprites.halo : this.sprites.ring);
      placeCentred(sprite, spot.x, spot.y, view.tile, Math.min(size, 3 * HALO_SIZE));
      sprite.tint = GLOW_SPOT;
      sprite.alpha = Math.min(strength, 1);
    }
  }

  /**
   * Note when cells catch and stop burning, so that their flames come up and die down
   * rather than appearing and going at once; forget those long out.
   */
  private syncFlames(): void {
    if (this.burning !== this.burningSeen) {
      this.burningSeen = this.burning;
      const now = new Set(this.burning);
      for (const index of this.burning) {
        const life = this.flameLife.get(index);
        if (life === undefined || life.died !== null) {
          this.flameLife.set(index, { born: this.timeS, died: null });
        }
      }
      for (const [index, life] of this.flameLife) {
        if (!now.has(index) && life.died === null) life.died = this.timeS;
      }
    }
    for (const [index, life] of this.flameLife) {
      if (life.died !== null && this.timeS - life.died > FLAME_OUT_S) this.flameLife.delete(index);
    }
  }

  /** How much of cell `index`'s fire shows (0–1): rising as it catches, sinking as it goes out. */
  private flameShare(index: number): number {
    const life = this.flameLife.get(index);
    if (life === undefined) return 0;
    const rising = Math.min((this.timeS - life.born) / FLAME_IN_S, 1);
    const sinking = life.died === null ? 1 : 1 - (this.timeS - life.died) / FLAME_OUT_S;
    return Math.max(Math.min(rising, sinking), 0);
  }

  private drawFires(view: View, dark: number): void {
    const land = view.land;
    this.syncFlames();
    if (land === null || this.flameLife.size === 0) return;
    const { cells, tile } = view;
    const inSight = this.inSight;
    inSight.length = 0;
    for (const index of this.flameLife.keys()) {
      const x = (index % land.width) + 0.5;
      const y = Math.floor(index / land.width) + 0.5;
      if (x < cells.x0 - 2 || x > cells.x1 + 2 || y < cells.y0 - 2 || y > cells.y1 + 2) continue;
      inSight.push(index);
    }
    const every = Math.max(1, Math.ceil(inSight.length / MOST_FIRES));
    const fullStrength = 0.55 + 0.45 * dark;
    // The whole fire lights the land round it, more so at night.
    let sumX = 0;
    let sumY = 0;
    for (const index of inSight) {
      sumX += (index % land.width) + 0.5;
      sumY += Math.floor(index / land.width) + 0.5;
    }
    if (inSight.length > 0) {
      const spread = Math.sqrt(inSight.length) * tile * 2.5 + 12;
      let shares = 0;
      for (const index of inSight) shares += this.flameShare(index);
      const shown = shares / inSight.length;
      const glow = (0.15 + 0.3 * dark) * shown;
      this.halo(sumX / inSight.length, sumY / inSight.length, spread, FIRE[0], glow, tile);
    }
    // Each burning cell: a small flickering glow, and flames licking up from it.
    for (let n = 0; n < inSight.length; n += every) {
      const index = inSight[n] ?? 0;
      // Coming up as the cell catches, dying down as it goes out.
      const share = this.flameShare(index);
      if (share <= 0.01) continue;
      const strength = fullStrength * share;
      const x = (index % land.width) + 0.5;
      const y = Math.floor(index / land.width) + 0.5;
      const flame = Math.floor(cellHash(index, Math.floor(this.timeS * 5), 342) * FIRE.length);
      const colour = FIRE[flame] ?? FIRE[0];
      // Off the cell's middle by a hash, so that a fire is not a grid of lamps.
      const fx = x + (cellHash(index, 1, 345) - 0.5) * 0.6;
      const fy = y + (cellHash(index, 2, 345) - 0.5) * 0.6;
      const size = Math.max(tile * 0.9, 4);
      this.halo(fx, fy, size, colour, 0.6 * strength * this.flicker(index), tile);
      const flames = plume(this.plumes.flames, fx, fy, 0.4, 6 + tile * 0.5, 1, 0.8);
      flames.from = tile >= 32 ? 3 : 2;
      flames.to = 1;
      flames.alpha = strength;
      flames.salt = index;
      if (tile < 8) {
        // On the map a burning cell is a flicker of light and a spark or two.
        this.puffs(flames, 1, FIRE[(flame + 1) % FIRE.length] ?? SPARK, tile, true);
        continue;
      }
      // Closer: a bed of glowing embers on the ground (under the plants), and flames
      // standing among the plants, sorted with them: one to a cell in the middle view, two
      // larger ones up close, each with its own glow and embers rising from it. A burning
      // tree or bush burns in its crown too. Whole multiples of size, for hard pixel edges.
      const close = tile >= 32;
      const embers = emberTextures();
      const ember = embers[(Math.floor(this.timeS * 4) + index) % embers.length];
      if (ember !== undefined) {
        const bed = this.floorPool.next(ember);
        // A cell across up close (two screen pixels to its texel), half that in the middle view.
        placeCentred(
          bed,
          x,
          y + 0.15,
          tile,
          close ? ember.width * 2 : ember.width / 2,
          close ? ember.height * 2 : ember.height / 2,
        );
        tint(bed, 0xffffff);
        bed.alpha = 0.95 * Math.min(share * 2, 1);
      }
      const count = close ? 2 : 1;
      const frames = close ? this.sprites.bigFlames : this.sprites.flames;
      const scale = close ? 2 : 1;
      const height = (land.plantHeight?.[index] ?? 0) / 255;
      const form = land.coverClasses[land.cover[index] ?? 0] ?? "";
      const woody = form === "BROADLEAF" || form === "CONIFER" || form === "SHRUB";
      const crown = woody ? (form === "SHRUB" ? 0.35 : 0.5 + 0.6 * height) : 0;
      for (let k = 0; k < count + (crown > 0 ? 1 : 0); k++) {
        const inCrown = k === count;
        const ox = count === 1 && !inCrown ? 0 : (cellHash(index, k, 346) - 0.5) * 0.7;
        const oy = count === 1 && !inCrown ? 0 : (cellHash(index, k, 347) - 0.5) * 0.5;
        // Up close the big flame flickers slowly (its six frames are large); far, faster.
        const rate = close
          ? FLAME_FPS_CLOSE * (0.8 + 0.4 * cellHash(index, k, 349))
          : 7 + 4 * cellHash(index, k, 349);
        const frame = (Math.floor(this.timeS * rate) + k + index) % frames.length;
        const footY = fy + (inCrown ? 0.05 : oy);
        const sprite = this.standPool.next(
          frames[frame] ?? this.sprites.fleck,
          view.rows ?? null,
          footY,
        );
        const size = inCrown && close ? scale / 2 : scale;
        const w = sprite.texture.width * size;
        const h = sprite.texture.height * size;
        // Its foot on the place (or in the crown), rising from it.
        placeCentred(sprite, fx + ox, footY - (inCrown ? crown : 0) - h / 2 / tile, tile, w, h);
        tint(sprite, 0xffffff);
        // Up close a flame is see-through, so what stands behind it shows.
        sprite.alpha = (close ? FLAME_ALPHA_CLOSE : 1) * share;
        // Fire makes its own light: in the dark (and under cloud's grey) the tinted flame
        // is lit again by an added copy over it.
        const unlit = Math.max(dark, this.overcast * 0.6);
        if (unlit > 0.05) {
          const lit = this.lightPool.next(sprite.texture);
          lit.position.copyFrom(sprite.position);
          lit.scale.copyFrom(sprite.scale);
          tint(lit, 0xffffff);
          lit.alpha = Math.min(unlit, 1) * (close ? 0.5 : 0.85) * share;
        }
        if (close) {
          const glow = FIRE[(frame + k) % FIRE.length] ?? FIRE[0];
          this.halo(
            fx + ox,
            footY - (inCrown ? crown : 0) - h / 3 / tile,
            w * 1.8,
            glow,
            (close ? 0.3 : 0.45) * strength * this.flicker(index + k),
            tile,
          );
          const sparks = plume(
            this.plumes.sparks,
            fx + ox,
            footY - (inCrown ? crown : 0) - (h * 0.6) / tile,
            0.08,
            22,
            4,
            1.1,
          );
          sparks.from = 2;
          sparks.to = 1;
          sparks.alpha = strength;
          sparks.salt = index * 7 + k;
          this.puffs(sparks, 3, SPARK, tile, true);
        }
      }
      if (!close) this.puffs(flames, 2, SPARK, tile, true);
      else {
        // Small flames licking round the big ones, on the ground of the cell, each on its
        // own slow flicker, sorted among the plants as they are.
        for (let k = 0; k < SMALL_FLAMES; k++) {
          const sx = x + (cellHash(index, k, 352) - 0.5) * 0.9;
          const sy = y + (cellHash(index, k, 353) - 0.5) * 0.8;
          const small = this.sprites.flames;
          const frame =
            (Math.floor(this.timeS * (5 + 3 * cellHash(index, k, 354))) + k) % small.length;
          const flame = this.standPool.next(
            small[frame] ?? this.sprites.fleck,
            view.rows ?? null,
            sy,
          );
          const w = flame.texture.width * 2;
          const h = flame.texture.height * 2;
          placeCentred(flame, sx, sy - h / 2 / tile, tile, w, h);
          tint(flame, 0xffffff);
          flame.alpha = FLAME_ALPHA_CLOSE * share;
        }
      }
    }
    // Smoke from some of them, grey and drifting with the wind.
    const smokes = Math.min(MOST_SMOKES, inSight.length);
    for (let s = 0; s < smokes; s++) {
      const index = inSight[Math.floor((s * inSight.length) / smokes)] ?? 0;
      const smoke = plume(
        this.plumes.smoke,
        (index % land.width) + 0.5,
        Math.floor(index / land.width) + 0.5,
        0.4,
        6,
        3,
        4,
      );
      smoke.from = 3;
      smoke.to = 10;
      smoke.alpha = 0.7 * this.flameShare(index);
      smoke.salt = index;
      this.puffs(smoke, 3, SMOKE, tile);
    }
  }

  private puffs(plume: Plume, count: number, colour: number, tile: number, glow = false): void {
    for (let slot = 0; slot < count; slot++) {
      const puff = puffAt(plume, slot, this.timeS, tile, this.puff);
      if (puff.alpha <= 0.01) {
        (glow ? this.lightPool : this.groundPool).skip();
        continue;
      }
      const sprite = glow
        ? this.lightPool.next(this.sprites.fleck)
        : this.groundPool.next(this.sprites.puff);
      // What glows is a fleck of a pixel or two; smoke and dust are puffs.
      placeCentred(
        sprite,
        puff.x,
        puff.y,
        tile,
        glow ? Math.max(Math.round(puff.size), 1) : puff.size,
      );
      tint(sprite, colour);
      sprite.alpha = puff.alpha;
    }
  }

  /** Draw `effect`; how much it shakes the picture now (art pixels). */
  private drawEffect(effect: Effect, view: View): number {
    const { tile } = view;
    const { x, y, radius, age, salt } = effect;
    if (age < (effect.delayS ?? 0)) return 0;
    switch (effect.kind) {
      case "cone":
      case "crater": {
        // A crater's rim stands where the sim dug, its thrown earth beyond.
        const floor = (texture: Texture): Sprite => this.floorPool.next(texture);
        // Drawn as long as the land keeps it, fading over its last days rather than going
        // at once.
        const left = effect.untilMs >= 0 ? (effect.untilMs - this.simMs) / MARK_FADE_MS : 1;
        const shown = Math.min(Math.max(left, 0), 1);
        if (shown <= 0) return 0;
        if (effect.kind === "crater") {
          this.crater(effect, view, shown);
          return 0;
        }
        // A cone's scree lies on the ground; the cone stands among the plants, sorted at the
        // south edge of its foot: nothing stands on it (its plants are not placed, the
        // creatures on it died), so it covers the place, and what is south of it is in front.
        // A new cone rises out of the ground over its first seconds, its scree spreading.
        const rise = Math.min(age / CONE_RISE_S, 1);
        this.mark(floor, "scree", x, y, radius * 2 * tile, tile, shown * rise);
        this.mark(
          this.stand(view, y + radius),
          "cone",
          x,
          y,
          radius * 2 * tile,
          tile,
          shown * Math.min(rise * 3, 1),
          0,
          rise,
        );
        return 0;
      }
      case "volcano": {
        // The eruption comes out of the summit, which stands above the cone's foot.
        const summit = coneSummit(radius * 2 * tile) / tile;
        const fading =
          effect.untilMs >= 0 && this.simMs >= effect.untilMs
            ? Math.max(1 - (effect.age - effect.wallS), 0)
            : 1;
        const size = Math.max(radius * tile * 1.4, 8);
        const colour =
          LAVA[Math.floor(cellHash(salt, Math.floor(this.timeS * 4), 343) * LAVA.length)] ??
          LAVA[0];
        // The glow swells as the eruption begins.
        const swell = Math.min(age / CONE_RISE_S, 1);
        this.halo(x, y - summit, size, colour, fading * swell * this.flicker(salt), tile);
        // Its lava: the pool in the mouth and the rivers down the cone, drawn over it
        // untinted (it makes its own light), cooling to crust as the eruption ends.
        const frame = Math.floor(this.timeS * LAVA_FPS) % LAVA_FRAMES;
        this.mark(
          this.stand(view, y + radius),
          "lava",
          x,
          y,
          radius * 2 * tile,
          tile,
          fading * Math.min(age / CONE_RISE_S, 1),
          frame,
          Math.min(age / CONE_RISE_S, 1),
        );
        // A column of ash, dark, rising high and spreading with the wind.
        this.puffs(
          {
            x,
            y: y - summit,
            spread: radius * 0.2,
            rise: 14,
            drift: 5,
            life: 8,
            from: 6,
            to: 26,
            alpha: 0.85 * fading * swell,
            salt,
          },
          18,
          ASH,
          tile,
        );
        this.puffs(
          {
            x,
            y: y - summit,
            spread: radius * 0.15,
            rise: 22,
            drift: 2,
            life: 1.6,
            from: 1,
            to: 1,
            alpha: fading * swell,
            salt: salt + 1,
          },
          12,
          SPARK,
          tile,
          true,
        );
        return age < 2 ? QUAKE_PX * (1 - age / 2) : 0;
      }
      case "quake": {
        if (age < 1.5) {
          this.puffs(
            {
              x,
              y,
              spread: radius * 0.6,
              rise: 2,
              drift: 1,
              life: 2.5,
              from: 3,
              to: 9,
              alpha: 0.5,
              salt,
            },
            12,
            DUST,
            tile,
          );
        }
        return QUAKE_PX * Math.max(1 - age / QUAKE_S, 0);
      }
      case "meteor": {
        if (age < METEOR_FALL_S) {
          // The streak: from high up and to the left, its head bright, its trail fading.
          const t = age / METEOR_FALL_S;
          const size = METEOR_SIZE[view.view];
          const fromX = x - (60 * Math.sqrt(size)) / tile;
          const fromY = y - (90 * Math.sqrt(size)) / tile;
          for (let k = 0; k < 8; k++) {
            const back = Math.max(t - k * 0.04, 0);
            const hx = fromX + (x - fromX) * back;
            const hy = fromY + (y - fromY) * back;
            this.halo(
              hx,
              hy,
              size * (k === 0 ? 8 : 6 - k * 0.5),
              k === 0 ? 0xffffff : SPARK,
              1 - k / 8,
              tile,
            );
          }
          return 0;
        }
        const since = age - METEOR_FALL_S;
        if (!effect.struck) {
          effect.struck = true;
          this.flashLeft = FLASH_S;
        }
        this.halo(x, y, Math.max(radius * tile * 2, 10), LAVA[1], Math.max(1 - since / 3, 0), tile);
        this.puffs(
          {
            x,
            y,
            spread: radius * 0.8,
            rise: 3,
            drift: 2,
            life: 3,
            from: 4,
            to: 12,
            alpha: 0.6 * Math.max(1 - since / (METEOR_S - METEOR_FALL_S), 0),
            salt,
          },
          16,
          DUST,
          tile,
        );
        return since < 1.5 ? IMPACT_PX * (1 - since / 1.5) : 0;
      }
      case "seed":
      case "ark": {
        const life = Math.min(age / 1, 1) * Math.max(Math.min((BEAM_S - age) / 2, 1), 0);
        const colour = effect.kind === "seed" ? SEED_GOLD : ARK_LIGHT;
        if (effect.kind === "seed") {
          // The seed power sows the bare land of the whole island (the sim aims it nowhere):
          // golden motes drift down onto the bare cells in sight.
          this.drawSeedMotes(view, life, salt);
          return 0;
        }
        // As wide as the place the newcomers land on, in every view.
        const grow = closeness(tile);
        const beam = this.lightPool.next(this.sprites.beam);
        placeCentred(beam, x, y - (40 * grow) / tile, tile, 16 * grow, 88 * grow);
        beam.tint = colour;
        beam.alpha = 0.9 * life;
        this.halo(x, y, 28 * grow, colour, 0.8 * life, tile);
        // Its light pooled on the ground round its foot, flattened as the ground is seen.
        const pool = this.lightPool.next(this.sprites.halo);
        placeCentred(pool, x, y, tile, 40 * grow, 16 * grow);
        pool.tint = colour;
        pool.alpha = 0.55 * life;
        // Motes falling onto the place.
        this.puffs(
          {
            x,
            y: y - (20 * grow) / tile,
            spread: (2.5 * grow) / Math.max(tile / 8, 1) + 0.5,
            rise: -10,
            drift: 0,
            life: 2,
            from: 1,
            to: 1,
            alpha: life,
            salt,
          },
          24,
          colour,
          tile,
          true,
        );
        return 0;
      }
      case "arrival": {
        // One of the ark's newcomers coming into being: a thread of light comes down onto
        // it, flares, and leaves sparks rising as it takes shape.
        const phase = age / ARRIVE_S;
        if (phase >= 1) return 0;
        const grow = closeness(tile);
        const thread = this.lightPool.next(this.sprites.beam);
        const fall = Math.min(phase / 0.3, 1);
        placeCentred(
          thread,
          x,
          y - (30 * grow * (1 - fall * 0.5)) / tile,
          tile,
          3 * grow,
          60 * grow * fall,
        );
        thread.tint = ARK_LIGHT;
        thread.alpha = 0.8 * (1 - phase);
        const spot = this.lightPool.next(this.sprites.halo);
        placeCentred(spot, x, y, tile, 10 * grow, 4 * grow);
        spot.tint = ARK_LIGHT;
        spot.alpha = 0.6 * (1 - phase);
        this.halo(x, y, 10 * grow * (0.6 + phase), ARK_LIGHT, 0.7 * (1 - phase), tile);
        this.puffs(
          {
            x,
            y,
            spread: (0.4 * grow) / Math.max(tile / 8, 1) + 0.15,
            rise: 6 * grow,
            drift: 0,
            life: 1.2,
            from: 1,
            to: 1,
            alpha: 1 - phase,
            salt,
          },
          8,
          ARK_LIGHT,
          tile,
          true,
        );
        return 0;
      }
      case "billow": {
        // A cloud of dust over the place as the ground heaves or is struck: it hides what
        // stood there while it goes (the plants fade out under it), then thins away.
        const since = age - (effect.delayS ?? 0);
        const cloud =
          Math.min(since / BILLOW_IN_S, 1) *
          Math.min(Math.max((BILLOW_S - since) / BILLOW_OUT_S, 0), 1);
        if (cloud <= 0.01) return 0;
        const pixel = tile >= 32 ? 2 : 1;
        // A few lumpy clouds over the place, swelling and drifting apart as they thin.
        const grow = 1 + 0.25 * Math.min(since / BILLOW_S, 1);
        for (let k = 0; k < BILLOW_CLOUDS; k++) {
          const angle = 2 * Math.PI * (k / BILLOW_CLOUDS + cellHash(salt, k, 711) * 0.3);
          const off = k === 0 ? 0 : radius * (0.55 + 0.25 * cellHash(salt, k, 712));
          // Painted once at its first size and stretched as it swells: a texture made anew
          // at each size would redraw the whole cloud's dither in one frame.
          const across = ((k === 0 ? 1.5 : 1.0) * radius * tile) / pixel;
          const texture = dustTexture(across, (salt + k) % 4);
          const sprite = this.groundPool.next(texture);
          const drift = since * 0.15;
          placeCentred(
            sprite,
            x + Math.cos(angle) * (off + drift),
            y + Math.sin(angle) * (off + drift) * 0.8 - since * 0.3,
            tile,
            texture.width * pixel * grow,
            texture.height * pixel * grow,
          );
          sprite.tint = 0xffffff;
          sprite.alpha = 0.92 * cloud;
        }
        // Small puffs round its edge, for the motion.
        this.puffs(
          {
            x,
            y,
            spread: radius * 1.3,
            rise: 6,
            drift: 3,
            life: 1.4,
            from: 3,
            to: 9,
            alpha: 0.9 * cloud,
            salt,
          },
          BILLOW_PUFFS,
          DUST,
          tile,
        );
        return 0;
      }
      case "strike":
        return 0; // drawn with the lightning
      case "ash":
        // An animal caught in the fire: a grey puff rising where it fell.
        this.puffs(
          {
            x,
            y,
            spread: 0.2,
            rise: 5,
            drift: 1,
            life: 1.6,
            from: 2,
            to: 7,
            alpha: Math.max(1 - age / ASH_S, 0),
            salt,
          },
          5,
          SMOKE,
          tile,
        );
        return 0;
      case "sparks":
        this.puffs(
          {
            x,
            y,
            spread: 0.3,
            rise: 14,
            drift: 3,
            life: 1,
            from: 1,
            to: 1,
            alpha: Math.max(1 - age / SPARKS_S, 0),
            salt,
          },
          10,
          SPARK,
          tile,
          true,
        );
        return 0;
    }
  }

  private drawRain(view: View): void {
    if (this.rain <= 0.01) return;
    // Drops as large as the view is close: fine on the map, longer up close; in layers
    // that fall at different speeds (the near ones faster, longer, brighter), all leaning
    // with the wind, which gusts in a thunderstorm.
    const scale = RAIN_SCALE[view.view];
    // A storm's gusts swing the wind back and forth, and every layer follows them.
    const gust =
      this.storm * (0.35 * Math.sin(this.timeS * 0.7) + 0.15 * Math.sin(this.timeS * 1.9));
    const lean = RAIN_LEAN[this.rainKind] + gust;
    for (const [layer, depth] of RAIN_LAYERS.entries()) {
      const speed = scale.speed * depth.speed * (1 + 0.6 * this.storm);
      const fall: Fall = { speed, slant: speed * lean, salt: 7 + layer };
      // At least as long as it falls in a frame, as a blur would be: a drop that jumps further
      // than its own length is taken by the eye for the one above it, and rain seems to rise.
      const blur = Math.ceil(speed / FRAME_RATE);
      const length = Math.max(
        Math.round(scale.length * depth.length * (1 + 0.3 * this.storm)),
        blur,
        1,
      );
      const texture = streakTexture(length, lean);
      // Where it is cold enough for snow to lie, it falls as snow (`drawSnow`).
      const drops = Math.round(
        RAINDROPS * this.rain * (1 - this.snowfall) * depth.share * scale.count,
      );
      for (let slot = 0; slot < drops; slot++) {
        const at = dropAt(fall, slot, this.timeS, view.width, view.height);
        const sprite = this.weatherPool.next(texture);
        // The streak's head where the drop is; its tail up the wind.
        sprite.position.set(
          Math.round(at.x) - (lean >= 0 ? texture.width - 1 : 0),
          Math.round(at.y) - texture.height + 1,
        );
        sprite.scale.set(1, 1);
        sprite.tint = RAIN_TONES[layer] ?? RAIN_TONES[1];
        sprite.alpha = scale.alpha * depth.alpha;
      }
    }
    // Where it falls: rings spreading on the water, and splashes on the land.
    const land = view.land;
    if (land === null || view.view === "map") return;
    const { cells, tile } = view;
    const count = Math.round(
      RIPPLES * this.rain * (1 - this.snowfall) * (view.view === "local" ? 1 : 2),
    );
    for (let slot = 0; slot < count; slot++) {
      const every = RIPPLE_S * (1 + cellHash(slot, 0, 409));
      const shifted = this.timeS + every * cellHash(slot, 1, 409);
      const showing = Math.floor(shifted / every);
      const phase = (shifted - showing * every) / every;
      const x = cells.x0 + (cells.x1 - cells.x0) * cellHash(slot, showing, 410);
      const y = cells.y0 + (cells.y1 - cells.y0) * cellHash(slot, showing, 411);
      const cell = Math.floor(y) * land.width + Math.floor(x);
      const wet = (land.heights[cell] ?? 1) <= land.seaLevel;
      if (wet) {
        const ring =
          this.sprites.rings[Math.min(Math.floor(phase * RINGS.length), RINGS.length - 1)];
        if (ring === undefined) continue;
        const sprite = this.ripplePool.next(ring);
        const size = ring.width * (tile >= 32 ? 2 : 1);
        placeCentred(sprite, x, y, tile, size, size * 0.6);
        sprite.tint = RIPPLE;
        sprite.alpha = 0.7 * (1 - phase);
      } else if (phase < 0.3) {
        const sprite = this.ripplePool.next(this.sprites.fleck);
        placeCentred(sprite, x, y, tile, 2, 1);
        sprite.tint = RIPPLE;
        sprite.alpha = 0.6;
      }
    }
  }

  /** The share of the land in sight that has snow lying (kept until the land or view changes). */
  private snowyShare(view: View): number {
    const land = view.land;
    if (land?.snow === undefined) return 0;
    const { x0, y0, x1, y1 } = view.cells;
    const key = `${Math.floor(x0)},${Math.floor(y0)},${Math.ceil(x1)},${Math.ceil(y1)}`;
    const known = this.snowShare;
    if (known !== null && known.land === land && known.key === key) return known.share;
    let landCells = 0;
    let snowy = 0;
    for (let y = Math.max(Math.floor(y0), 0); y < Math.min(Math.ceil(y1), land.height); y++) {
      for (let x = Math.max(Math.floor(x0), 0); x < Math.min(Math.ceil(x1), land.width); x++) {
        const cell = y * land.width + x;
        if ((land.heights[cell] ?? 0) <= land.seaLevel) continue;
        landCells++;
        if ((land.snow[cell] ?? 0) >= SNOW_FALLS_FROM) snowy++;
      }
    }
    const share = landCells === 0 ? 0 : snowy / landCells;
    this.snowShare = { land, key, share };
    return share;
  }

  /**
   * Snow falling where it is cold (snow lies on most of the land in sight): flakes drifting
   * down slowly in three layers, swaying, a pixel on the map and larger closer in; where it
   * is warmer the same weather falls as rain.
   */
  private drawSnow(view: View): void {
    if (this.rain <= 0.01 || this.snowfall <= 0.01) return;
    const size = SNOW_SIZE[view.view];
    for (const [layer, depth] of SNOW_LAYERS.entries()) {
      const speed = SNOW_SPEED * depth.speed * (1 + 0.5 * this.storm);
      const lean = RAIN_LEAN[this.rainKind] * 0.6 + this.storm * 0.3 * Math.sin(this.timeS * 0.7);
      const fall: Fall = { speed, slant: speed * lean, salt: 31 + layer };
      const flakes = Math.round(
        SNOWFLAKES * Math.min(this.rain, 1.2) * this.snowfall * depth.share,
      );
      for (let slot = 0; slot < flakes; slot++) {
        const at = dropAt(fall, slot, this.timeS, view.width, view.height);
        const sway = SNOW_SWAY * Math.sin(this.timeS * (1 + cellHash(slot, layer, 432)) + slot);
        const x = (((at.x + sway) % view.width) + view.width) % view.width;
        const sprite = this.weatherPool.next(this.sprites.fleck);
        const across = Math.max(Math.round(size * depth.size), 1);
        sprite.position.set(Math.round(x), Math.round(at.y));
        sprite.scale.set(across, across);
        sprite.tint = SNOW_TONES[layer] ?? 0xffffff;
        sprite.alpha = depth.alpha;
      }
    }
  }

  /**
   * The Christmas mod's fairy lights: on some of the trees and bushes in sight, a bulb in
   * one of four festive colours, each twinkling on its own beat, brighter in the dark.
   */
  private drawFairyLights(view: View, dark: number): void {
    const land = view.land;
    if (land === null) return;
    const { cells, tile } = view;
    const bright = FAIRY_DAY + (FAIRY_NIGHT - FAIRY_DAY) * dark;
    const bulb = Math.max(Math.round(tile / 8), 1);
    let drawn = 0;
    const x0 = Math.max(Math.floor(cells.x0), 0);
    const x1 = Math.min(Math.ceil(cells.x1), land.width);
    for (
      let y = Math.max(Math.floor(cells.y0), 0);
      y < Math.min(Math.ceil(cells.y1), land.height);
      y++
    ) {
      for (let x = x0; x < x1; x++) {
        if (cellHash(x, y, 601) >= FAIRY_SHARE) continue;
        const cell = y * land.width + x;
        if ((land.biomass[cell] ?? 0) < VISIBLE_FROM) continue;
        if (!FAIRY_FORMS.includes(land.coverClasses[land.cover[cell] ?? 0] ?? "")) continue;
        const colour = FAIRY_COLOURS[Math.floor(cellHash(x, y, 602) * FAIRY_COLOURS.length)];
        const beat = Math.sin(this.timeS * FAIRY_TWINKLE + cellHash(x, y, 603) * 2 * Math.PI);
        const alpha = bright * (0.5 + 0.5 * beat);
        // Up in the crown, off the cell's middle by a hash.
        const lx = x + 0.2 + 0.6 * cellHash(x, y, 604);
        const ly = y + 0.1 + 0.5 * cellHash(x, y, 605);
        this.halo(lx, ly, bulb * 5, colour ?? FAIRY_COLOURS[0], 0.5 * alpha, tile);
        const sprite = this.lightPool.next(this.sprites.fleck);
        placeCentred(sprite, lx, ly, tile, bulb);
        sprite.tint = colour ?? FAIRY_COLOURS[0];
        sprite.alpha = Math.min(alpha, 1);
        if (++drawn >= MOST_FAIRY_LIGHTS) return;
      }
    }
  }

  /** The Christmas mod's winter star: a cross of 5×5 pixels high in the sky at dusk and at night. */
  private drawWinterStar(view: View, dark: number): void {
    const shown = Math.min(Math.max((dark - STAR_FROM) / (STAR_FULL - STAR_FROM), 0), 1);
    if (shown <= 0.01) return;
    const twinkle = 0.8 + 0.2 * Math.sin(this.timeS * 2.3);
    const alpha = shown * twinkle;
    const cx = Math.round(view.width * STAR_AT.x);
    const cy = Math.round(view.height * STAR_AT.y);
    const halo = this.boltPool.next(this.sprites.halo);
    placeCentred(halo, cx + 0.5, cy + 0.5, 1, 15);
    halo.tint = STAR_ARMS;
    halo.alpha = 0.35 * alpha;
    for (const [dx, dy, colour, fade] of [
      [0, 0, STAR_CORE, 1],
      [-1, 0, STAR_CORE, 1],
      [1, 0, STAR_CORE, 1],
      [0, -1, STAR_CORE, 1],
      [0, 1, STAR_CORE, 1],
      [-2, 0, STAR_ARMS, 0.7],
      [2, 0, STAR_ARMS, 0.7],
      [0, -2, STAR_ARMS, 0.7],
      [0, 2, STAR_ARMS, 0.7],
    ] as const) {
      const sprite = this.boltPool.next(this.sprites.fleck);
      sprite.position.set(cx + dx, cy + dy);
      sprite.scale.set(1, 1);
      sprite.tint = colour;
      sprite.alpha = alpha * fade;
    }
  }

  /** Thunder and storm bolts on the screen, and the fire's strike; the flash they make (0–1). */
  private drawLightning(view: View): number {
    let flash = 0;
    const margin = view.margin ?? 0;
    const draw = (paths: [number, number][][], width: number, alpha: number): void => {
      for (const [index, path] of paths.entries()) {
        const thick = index === 0 ? width : Math.max(width - 1, 1);
        for (const [px, py] of path) {
          if (py < 0 || py >= view.height || px < 0 || px >= view.width) continue;
          const sprite = this.boltPool.next(this.sprites.fleck);
          sprite.position.set(px - Math.floor(thick / 2), py);
          sprite.scale.set(thick, 1);
          sprite.tint = index === 0 ? BOLT : BOLT_GLOW;
          sprite.alpha = alpha;
        }
      }
    };
    for (const kind of ["thunder", "storm"] as const) {
      if (this.rainKind !== kind) continue;
      const bolt = boltAt(kind, this.timeS);
      if (bolt === null) continue;
      const { width, flash: bright, forks } = BOLTS[kind];
      // It shows, goes dark and shows again once, as a bolt flickers.
      const on = bolt.phase < 0.35 || (bolt.phase > 0.55 && bolt.phase < 0.8);
      if (!on) continue;
      const at = strikePoint(bolt.n, view.width, view.height);
      draw(boltPath(bolt.n, at.x, at.y, forks), width, 1);
      flash = Math.max(flash, bright * (1 - bolt.phase));
    }
    for (const effect of this.effects) {
      if (effect.kind !== "strike" || effect.age >= BOLTS.strike.lasts) continue;
      const phase = effect.age / BOLTS.strike.lasts;
      const x = Math.round((effect.x - view.cells.x0) * view.tile) + margin;
      const y = Math.round((effect.y - view.cells.y0) * view.tile) + margin;
      if (phase < 0.45 || (phase > 0.6 && phase < 0.85)) {
        draw(boltPath(effect.salt, x, y, BOLTS.strike.forks), BOLTS.strike.width, 1);
      }
      flash = Math.max(flash, BOLTS.strike.flash * (1 - phase));
    }
    return flash;
  }

  /** After the seed power, find the cells it sowed in the land that comes next. */
  private watchSowing(land: Land | null): void {
    if (this.sown.length > 0 && this.simMs > this.sownUntilMs) this.sown = [];
    if (land !== this.landNow) {
      this.landBefore = this.landNow;
      this.landNow = land;
      this.landChangedS = this.timeS;
    }
    const sowing = this.sowing;
    if (sowing === null || land === null) return;
    if (this.timeS - sowing.since > SOWING_WAIT_S) {
      this.sowing = null;
      return;
    }
    // The sown land comes with the power (a stream sends it just before) or after it.
    // Sown: bare before, growing after. A land that changed for another reason (a fire's,
    // coming with the power) sows nothing, and the next one is waited for.
    const before = this.landBefore;
    if (this.landChangedS < sowing.since || before === null || sowing.seen === land) return;
    sowing.seen = land;
    if (before.width !== land.width || before.height !== land.height) return;
    const sown: { cell: number; at: number; gone?: number }[] = [];
    for (let cell = 0; cell < land.biomass.length; cell++) {
      const was = before.biomass[cell] ?? 255;
      if (was >= SOWN_BARE || (land.biomass[cell] ?? 0) <= was) continue;
      if ((land.heights[cell] ?? 0) <= land.seaLevel) continue;
      sown.push({ cell, at: this.timeS + SPROUT_STAGGER_S * cellHash(cell, 0, 517) });
    }
    if (sown.length === 0) return;
    this.sowing = null;
    this.sown = sown;
    this.sownUntilMs = this.simMs + SPROUT_DAYS * MS_PER_DAY;
  }

  /**
   * The seed's sprouts on the cells it sowed: breaking the soil and growing leaf by leaf,
   * a few to a cell up close, one in the middle view, a green fleck on the map; a cell's
   * go once its plants are big enough to be drawn.
   */
  private drawSprouts(view: View): void {
    const land = view.land;
    if (land === null || this.sown.length === 0) return;
    const { cells, tile } = view;
    const frames = sproutTextures();
    const each = tile >= 32 ? 5 : tile >= 8 ? 1 : 0;
    const pixel = tile >= 32 ? 2 : 1;
    for (const sprout of this.sown) {
      const { cell, at } = sprout;
      const cx = cell % land.width;
      const cy = Math.floor(cell / land.width);
      if (cx < cells.x0 - 1 || cx > cells.x1 || cy < cells.y0 - 1 || cy > cells.y1) continue;
      // Once its plants are drawn, the sprouts fade as the plants fade in over them.
      if ((land.biomass[cell] ?? 0) >= VISIBLE_FROM) sprout.gone ??= this.timeS;
      const fading = sprout.gone === undefined ? 1 : 1 - (this.timeS - sprout.gone) / FADE_S;
      if (fading <= 0) continue;
      const age = this.timeS - at;
      if (age < 0) continue;
      if (each === 0) {
        const fleck = this.floorPool.next(this.sprites.fleck);
        placeCentred(fleck, cx + 0.5, cy + 0.5, tile, 1);
        fleck.tint = 0x7cc04a;
        fleck.alpha = Math.min(age / SPROUT_GROW_S, 1) * fading;
        continue;
      }
      for (let k = 0; k < each; k++) {
        const grown = age - k * 0.35;
        if (grown < 0) continue;
        const frame = Math.min(
          Math.floor((grown / SPROUT_GROW_S) * SPROUT_FRAMES.length),
          SPROUT_FRAMES.length - 1,
        );
        const texture = frames[frame];
        if (texture === undefined) continue;
        const x = cx + 0.15 + 0.7 * cellHash(cell, k, 518);
        const y = cy + 0.2 + 0.7 * cellHash(cell, k, 519);
        const sprite = this.standPool.next(texture, view.rows ?? null, y);
        // Its foot on the spot.
        placeCentred(
          sprite,
          x,
          y - (texture.height * pixel) / 2 / tile,
          tile,
          texture.width * pixel,
          texture.height * pixel,
        );
        sprite.tint = 0xffffff;
        sprite.alpha = fading;
        // A glint of the seed's gold as it breaks the soil.
        if (grown < 0.4) {
          const glint = this.lightPool.next(this.sprites.fleck);
          placeCentred(glint, x, y - pixel / tile, tile, pixel * 2);
          glint.tint = SEED_GOLD;
          glint.alpha = 1 - grown / 0.4;
        }
      }
    }
  }

  /** The seed power's motes falling on the bare land in sight. */
  private drawSeedMotes(view: View, life: number, salt: number): void {
    const land = view.land;
    if (land === null || life <= 0) return;
    const { cells, tile } = view;
    for (let slot = 0; slot < SEED_MOTES; slot++) {
      const every = 2 + cellHash(slot, salt, 412);
      const shifted = this.timeS + every * cellHash(slot, salt, 413);
      const showing = Math.floor(shifted / every);
      const phase = (shifted - showing * every) / every;
      const x = cells.x0 + (cells.x1 - cells.x0) * cellHash(slot, showing, 414);
      const y = cells.y0 + (cells.y1 - cells.y0) * cellHash(slot, showing, 415);
      const cell = Math.floor(y) * land.width + Math.floor(x);
      const bare = (land.heights[cell] ?? 0) > land.seaLevel && (land.biomass[cell] ?? 255) < 10;
      if (!bare) continue;
      // Down from above onto the place, a glint where it lands.
      const fall = (1 - Math.min(phase / 0.8, 1)) * 24;
      const sprite = this.lightPool.next(this.sprites.fleck);
      // Two art pixels across (three up close), so that it is seen in every view.
      placeCentred(sprite, x, y - fall / tile, tile, tile >= 32 ? 3 : 2);
      sprite.tint = SEED_GOLD;
      sprite.alpha = life * (phase > 0.8 ? (1 - phase) * 5 : 1);
      if (phase > 0.8) this.halo(x, y, 6, SEED_GOLD, 0.6 * life * (1 - phase) * 5, tile);
    }
  }

  /** A mark (`marks.ts`) whose foot is `across` art pixels wide, its foot's middle on (x, y). */
  private mark(
    place: (texture: Texture) => Sprite,
    kind: "cone" | "scree" | "lava" | "crater",
    x: number,
    y: number,
    across: number,
    tile: number,
    alpha: number,
    frame = 0,
    rise = 1,
  ): void {
    if (alpha <= 0.01) return;
    // Up close its art pixels are two screen pixels, as the plants' are.
    const pixel = tile >= 32 ? 2 : 1;
    const mark = markTexture(kind, across / pixel, frame);
    const sprite = place(mark.texture);
    sprite.anchor.set(mark.cx / mark.texture.width, mark.cy / mark.texture.height);
    sprite.position.set(Math.round(x * tile) / tile, Math.round(y * tile) / tile);
    // Rising (a new cone): it grows up out of its foot.
    const grown = rise >= 1 ? 1 : 0.2 + 0.8 * rise * rise * (3 - 2 * rise);
    sprite.scale.set(pixel / tile, (pixel / tile) * grown);
    sprite.tint = 0xffffff;
    sprite.alpha = alpha;
  }

  /** A crater on the ground, left out where the sea now is (`craterOnLand`). */
  private crater(effect: Effect, view: View, alpha: number): void {
    const { tile, land } = view;
    if (land === null || alpha <= 0.01) return;
    const pixel = tile >= 32 ? 2 : 1;
    const texels = Math.max(Math.round((effect.radius * 2 * tile) / CRATER_RIM / pixel), 5);
    const sea = seaAt(land);
    const half = texels / 2;
    const mark = craterOnLand(String(effect.salt), texels, land, (px, py) => {
      const cx = effect.x + ((px + 0.5 - half) * pixel) / tile;
      const cy = effect.y + ((py + 0.5 - half) * pixel) / tile;
      return sea(cx, cy) !== null;
    });
    const sprite = this.floorPool.next(mark.texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(Math.round(effect.x * tile) / tile, Math.round(effect.y * tile) / tile);
    sprite.scale.set(pixel / tile);
    sprite.tint = 0xffffff;
    sprite.alpha = alpha;
  }

  /** A placer of sprites standing among the plants with their foot at `footY` cells. */
  private stand(view: View, footY: number): (texture: Texture) => Sprite {
    // A row beyond the view is culled with its plants: such a thing goes in the nearest row.
    const row = Math.min(Math.max(footY, view.cells.y0), view.cells.y1);
    return (texture) => this.standPool.next(texture, view.rows ?? null, row);
  }

  /** An animal died in the fire at (x, y) cells: a puff of ash rises there. */
  burnt(x: number, y: number): void {
    this.effects.push({
      kind: "ash",
      x,
      y,
      radius: 0,
      age: 0,
      wallS: ASH_S,
      untilMs: -1,
      salt: ++this.salts,
      struck: false,
    });
  }

  /**
   * An animal new to the scene at (x, y) cells: if the ark's light is on that place, it is
   * one of its newcomers, so it comes into being here (how many wall seconds that takes);
   * otherwise 0 (it was born).
   */
  arrival(x: number, y: number): number {
    const ark = this.effects.find(
      (effect) =>
        effect.kind === "ark" &&
        effect.age < ARK_LATE_S &&
        Math.hypot(effect.x - x, effect.y - y) <= ARK_REACH,
    );
    if (ark === undefined) return 0;
    this.effects.push({
      kind: "arrival",
      x,
      y,
      radius: 0,
      age: 0,
      wallS: ARRIVE_S,
      untilMs: -1,
      salt: ++this.salts,
      struck: false,
    });
    return ARRIVE_S;
  }

  /** Whether cell (x, y) (its middle) is under a cone or a crater drawn now. */
  covers(x: number, y: number): boolean {
    for (const effect of this.effects) {
      if (effect.kind !== "cone" && effect.kind !== "crater") continue;
      // The cone with its scree; the crater with its rim and thickest ejecta.
      const reach = effect.radius * (effect.kind === "cone" ? COVER_CONE : COVER_CRATER);
      if (Math.hypot(x + 0.5 - effect.x, y + 0.5 - effect.y) <= reach) return true;
    }
    return false;
  }

  /** Whether cell (x, y) is burning now. */
  isBurning(index: number): boolean {
    return this.burning.includes(index);
  }

  /** The end of a world, at `moment`; how much it shakes the picture (art pixels). */
  private drawEnd(moment: Moment, view: View, dtS: number): number {
    const land = view.land;
    const { tile } = view;
    // The risen sea, over the old land as it rises and over the new as it falls back.
    const level = land === null ? null : seaLevelAt(land, moment);
    this.floodWait -= dtS;
    if (land !== null && level !== null) {
      if (this.floodLevel !== level && this.floodWait <= 0) {
        this.paintFlood(land, level);
        this.floodLevel = level;
        this.floodWait = FLOOD_REPAINT_S;
      }
      this.flood.visible = true;
    } else this.flood.visible = false;
    // Vents of lava where the sea has not yet come.
    if (land !== null && moment.vents > 0) {
      const open = Math.round(this.vents.length * moment.vents);
      this.vents.slice(0, open).forEach((vent, n) => {
        const height = land.heights[Math.floor(vent.y) * land.width + Math.floor(vent.x)] ?? 1;
        if (level !== null && height < level) return;
        const colour =
          LAVA[Math.floor(cellHash(n, Math.floor(this.timeS * 4), 344) * LAVA.length)] ?? LAVA[0];
        this.halo(vent.x, vent.y, Math.max(5 * tile, 14), colour, this.flicker(n + 1000), tile);
        // Lava running from it.
        for (let k = 0; k < 3; k++) {
          const angle = 2 * Math.PI * cellHash(n, k, 348);
          const reach = 1 + 2 * cellHash(n, k, 349);
          const run = LAVA[(n + k) % LAVA.length] ?? LAVA[0];
          const rx = vent.x + reach * Math.cos(angle);
          const ry = vent.y + reach * Math.sin(angle);
          this.halo(rx, ry, Math.max(2 * tile, 6), run, 0.8 * this.flicker(n + k), tile);
        }
        if (n % 4 === 0) {
          this.puffs(
            {
              x: vent.x,
              y: vent.y,
              spread: 0.5,
              rise: 8,
              drift: 4,
              life: 5,
              from: 3,
              to: 12,
              alpha: 0.6,
              salt: n + 500,
            },
            4,
            ASH,
            tile,
          );
        }
      });
    }
    // Ash falling across the screen.
    const flecks = Math.round(ASHFALL * moment.ash);
    const fall: Fall = { speed: 18, slant: 6, salt: 9 };
    for (let slot = 0; slot < flecks; slot++) {
      const at = dropAt(fall, slot, this.timeS, view.width, view.height);
      const sprite = this.weatherPool.next(this.sprites.fleck);
      sprite.position.set(Math.round(at.x), Math.round(at.y));
      sprite.scale.set(1, 1);
      sprite.tint = slot % 3 === 0 ? 0x8a7f80 : ASH;
      sprite.alpha = 0.9;
    }
    return moment.shake;
  }

  private paintFlood(land: Land, level: number): void {
    if (this.floodCanvas?.width !== land.width || this.floodCanvas.height !== land.height) {
      this.floodTexture?.destroy(true);
      this.floodCanvas = document.createElement("canvas");
      this.floodCanvas.width = land.width;
      this.floodCanvas.height = land.height;
      this.floodTexture = Texture.from({ resource: this.floodCanvas, scaleMode: "nearest" });
      this.flood.texture = this.floodTexture;
      // One texel to the cell, as the world layer is.
      this.flood.position.set(0, 0);
      this.flood.scale.set(1, 1);
    }
    const context = this.floodCanvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(land.width, land.height);
    floodPixels(land, level, image.data);
    context.putImageData(image, 0, 0);
    this.floodTexture?.source.update();
  }

  /** What the atmosphere shows (tests). */
  get state(): {
    light: number;
    tint: number;
    rain: RainKind;
    burning: number;
    effects: string[];
    act: string | null;
    graded: boolean;
    snowfall: number;
  } {
    return {
      light: this.ease.value,
      tint: packRgb(this.shown),
      rain: this.rainKind,
      burning: this.burning.length,
      effects: this.effects.map((effect) => effect.kind),
      act: this.sequence.active ? this.sequence.moment.act : null,
      graded: this.graded,
      snowfall: this.snowfall,
    };
  }

  /** Sprites drawn last frame: lights, ground, weather (tests). */
  get counts(): {
    lights: number;
    ground: number;
    weather: number;
    flames: number;
    ripples: number;
    bolts: number;
    sown: number;
  } {
    return {
      sown: this.sown.length,
      lights: this.lightPool.shown,
      ground: this.groundPool.shown,
      weather: this.weatherPool.shown,
      flames: this.standPool.shown,
      ripples: this.ripplePool.shown,
      bolts: this.boltPool.shown,
    };
  }
}

/** A plume to be set afresh each time it is used (`plume`). */
function newPlume(): Plume {
  return { x: 0, y: 0, spread: 0, rise: 0, drift: 0, life: 1, from: 0, to: 0, alpha: 0, salt: 0 };
}

/** Set `into` rising from (x, y) cells: where, how it moves and how long a puff lasts; the caller sets the rest. */
function plume(
  into: Plume,
  x: number,
  y: number,
  spread: number,
  rise: number,
  drift: number,
  life: number,
): Plume {
  into.x = x;
  into.y = y;
  into.spread = spread;
  into.rise = rise;
  into.drift = drift;
  into.life = life;
  return into;
}
