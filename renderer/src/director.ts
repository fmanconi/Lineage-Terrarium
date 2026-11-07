/**
 * The documentary camera (R3, ADR 0020): which view the screen shows, where it looks,
 * and whom it follows. The owner's view button steps through the three views:
 *
 *   map      the whole continent, still: where the desk rests
 *   middle   a region, drifting slowly from one place on the island to another
 *   local    one animal from close by, of a species drawn at random; after about five
 *            minutes another, glided to if it is near, cut to if not
 *
 * and from the local view back to the map. While a chronicle entry with a place is on the
 * scroll, the local view's camera leaves its animal to visit the place, holds there while
 * the entry is read and comes back to the same animal (R5). Fifteen minutes after the last press the
 * screen goes back to the map by itself. Changes of view, and cuts, dip to dark and back,
 * waiting in the dark until the new view is painted (painted pixels shimmer at zooms in
 * between, so the camera never zooms: renderer.md).
 *
 * Pure: the page hands it the time that passed, what the world holds and whether the view
 * is painted, and draws what it says; random draws come from the stream it is given.
 */
import { Spring, Velocity, framing, within, type Point, type SpringOptions } from "./camera";
import type { ViewName } from "./landscape";
import type { Random } from "./rng";

/** Back to the map after this long without a press (seconds; the owner, 2026-10-20). */
export const IDLE_S = 15 * 60;
/** Seconds on one animal before the next, from and to (about five minutes, the owner). */
export const FOLLOW_MIN_S = 4 * 60;
export const FOLLOW_MAX_S = 6 * 60;
/** Seconds to dip to dark, the longest wait in the dark for a view to be painted, and back. */
export const DIP_OUT_S = 0.4;
export const WAIT_MAX_S = 3;
export const DIP_IN_S = 0.6;
/** Frames drawn fully dark before the view changes under the dark. */
export const DARK_FRAMES = 2;
/** The middle view drifts this fast (cells a second) to places this far apart (cells). */
const DRIFT_SPEED = 1.2;
const DRIFT_MIN_CELLS = 20;
const DRIFT_MAX_CELLS = 70;
/** And lingers at each this long (seconds), from and to. */
const LINGER_MIN_S = 8;
const LINGER_MAX_S = 20;
/** Cells tried for a place on land to drift to; failing all, any place. */
const DRIFT_TRIES = 40;
/** The next animal within this many view widths is glided to; further, the camera cuts. */
const GLIDE_WIDTHS = 1;
/** Following: lead the subject by this many seconds of its walk; let it potter this far. */
const LEAD_S = 1;
const DEAD_ZONE_CELLS = 1;
/** Seconds over which the subject's walking speed is taken in. */
const VELOCITY_SMOOTH_S = 1.5;
/** How the camera moves in each way of moving. */
const DRIFTING: SpringOptions = { periodS: 6, damping: 1, maxSpeed: 2.5 };
const FOLLOWING: SpringOptions = { periodS: 3, damping: 0.9, maxSpeed: 6 };
const GLIDING: SpringOptions = { periodS: 3.6, damping: 1, maxSpeed: 8 };
/** A glide is over when the camera is this close to its new subject (cells). */
const GLIDE_DONE_CELLS = 0.5;
/**
 * A visit to a chronicle entry's place, and back: quicker than a glide to the next animal,
 * since the entry is read in a few seconds, but still eased in and out.
 */
const VISITING: SpringOptions = { periodS: 2.4, damping: 1, maxSpeed: 16 };
/** A place within this many local views' widths is glided to and back; further, the camera cuts. */
const VISIT_GLIDE_WIDTHS = 3;

/** The director's clock: how long the screen waits for a press, and stays on an animal. */
export interface Timings {
  idleS: number;
  followMinS: number;
  followMaxS: number;
}
export const TIMINGS: Timings = {
  idleS: IDLE_S,
  followMinS: FOLLOW_MIN_S,
  followMaxS: FOLLOW_MAX_S,
};

/** What the button leads to from each view. */
export const NEXT: Readonly<Record<ViewName, ViewName>> = {
  map: "middle",
  middle: "local",
  local: "map",
};

/** Seconds spent on each view in autonomous documentary tour mode (`autoTour`). */
export const AUTO_TOUR_S: Readonly<Record<ViewName, number>> = {
  map: 180,
  middle: 210,
  local: 300,
};

/** An animal the camera may follow: where it is drawn, in cells. */
export interface Subject {
  id: number;
  /** Its species; 0 for none yet (newcomers). */
  species: number;
  x: number;
  y: number;
  torpid: boolean;
}

/** What the director reads of the scene each frame. */
export interface Scene {
  /** The world in cells. */
  width: number;
  height: number;
  /** Whether a place is land: the middle view drifts over the island, not the sea. */
  isLand(x: number, y: number): boolean;
  /** The animals alive now. */
  subjects: readonly Subject[];
  /** Whether the view shown is painted: a dip waits in the dark until it is. */
  ready: boolean;
  /**
   * The chronicle entry on the scroll and where it happened (cells), for the local view's
   * camera to visit; null when there is none to visit (no entry out, one without a place,
   * or a world ending).
   */
  place?: Visit | null;
}

/** A chronicle entry's place, to visit while its scroll is out. */
export interface Visit {
  /** The entry's number in the chronicle: each entry is visited once. */
  entry: number;
  x: number;
  y: number;
}

/** What the screen shows this frame. */
export interface Shot {
  view: ViewName;
  /** The middle of the picture, in cells. */
  centre: Point;
  /** How dark the picture is dipped: 0 clear, 1 dark. */
  dim: number;
  /** The animal followed in the local view; null otherwise. */
  subject: number | null;
}

/** How the camera is moving in its view. */
export type Motion = "still" | "drift" | "linger" | "follow" | "glide" | "visit" | "return";

type Dip = { phase: "out" | "dark" | "wait" | "in"; t: number; then: (scene: Scene) => void };

export class Director {
  private view: ViewName = "map";
  private readonly spring: Spring;
  private readonly walking = new Velocity(VELOCITY_SMOOTH_S);
  private dip: Dip | null = null;
  /**
   * Whether the next animal to follow is chosen ahead (`lookAhead`): live, as on the desk;
   * not for films and stills, whose camera draws its choices when it always did.
   */
  looksAhead = false;
  /**
   * Autonomous documentary mode (Smerdino screensaver): gently cycles map → middle → local
   * instead of resting permanently on the map when idle.
   */
  autoTour = false;
  private upcomingId: number | null = null;
  private upcomingAt: Point | null = null;
  /** Where the middle view will come down next, chosen ahead as the animal is (`lookAhead`). */
  private upcomingPlace: Point | null = null;
  /** Frames drawn fully dark so far before the cut (`DARK_FRAMES`). */
  private darkFrames = 0;
  /** The view a press during a dip leads on from: the one the dip is going to. */
  private going: ViewName | null = null;
  private idle = 0;
  private motion: Motion = "still";
  /** The middle view: the point the camera is pulled toward, the place it goes to, and for how long it lingers there. */
  private readonly carrot: Point = { x: 0, y: 0 };
  private readonly place: Point = { x: 0, y: 0 };
  private linger = 0;
  /** The local view: whom it follows and for how much longer. */
  private subject: number | null = null;
  private follow = 0;
  /** The local view: the place it is visiting, and the last entry visited (or passed over). */
  private visit: (Visit & Point) | null = null;
  private visited: number | null = null;

  /** `sizes`: the cells each view has in sight. */
  constructor(
    private readonly sizes: Readonly<Record<ViewName, { width: number; height: number }>>,
    private readonly random: Random,
    private readonly timings: Timings = TIMINGS,
  ) {
    this.spring = new Spring({ x: 0, y: 0 }, DRIFTING);
  }

  /** The view button was pressed. */
  press(): void {
    this.idle = 0;
    this.go(NEXT[this.going ?? this.view]);
  }

  /** Straight back to the map. */
  toMap(): void {
    this.idle = 0;
    if ((this.going ?? this.view) !== "map") this.go("map");
  }

  /** Dip into the local view following a living member of `speciesId` (from the field guide). */
  followSpecies(speciesId: number): void {
    this.idle = 0;
    this.going = "local";
    this.cut((scene) => {
      this.going = null;
      this.view = "local";
      this.walking.reset();
      this.visit = null;
      this.visited = scene.place?.entry ?? null;
      this.spring.options = FOLLOWING;
      this.motion = "follow";
      const ofSpecies = scene.subjects.filter((s) => s.species === speciesId);
      const awake = ofSpecies.filter((s) => !s.torpid);
      const pool = awake.length > 0 ? awake : ofSpecies;
      const others = pool.filter((s) => s.id !== this.subject);
      const candidates = others.length > 0 ? others : pool;
      const next =
        candidates.length > 0
          ? (candidates[Math.floor(this.random() * candidates.length)] ?? null)
          : this.choose(scene, null);
      this.subject = next?.id ?? null;
      this.follow = this.followTime();
      this.spring.snap(next ?? { x: scene.width / 2, y: scene.height / 2 });
    });
  }

  /** What the camera is doing, for tests and the page's readout. */
  get state(): {
    view: ViewName;
    motion: Motion;
    dipping: boolean;
    idleS: number;
    followLeftS: number;
    /** The place the local view is visiting (cells, clamped to the world), or null. */
    visit: Visit | null;
  } {
    return {
      view: this.view,
      motion: this.motion,
      dipping: this.dip !== null,
      idleS: this.idle,
      followLeftS: this.follow,
      visit: this.visit === null ? null : { ...this.visit },
    };
  }

  /** Move on by `dtS` seconds and say what to show. */
  update(dtS: number, scene: Scene): Shot {
    this.idle += dtS;
    if (this.autoTour) {
      const stayS = AUTO_TOUR_S[this.view];
      if (this.idle >= stayS && this.dip === null && (scene.place ?? null) === null) {
        this.idle = 0;
        this.go(NEXT[this.view]);
      }
    } else if (this.view !== "map" && this.idle >= this.timings.idleS && this.going !== "map") {
      this.go("map");
    }
    this.moveDip(dtS, scene);
    this.film(dtS, scene);
    if (this.looksAhead) this.lookAhead(scene);
    const size = this.sizes[this.view];
    const centre =
      this.view === "map"
        ? { x: scene.width / 2, y: scene.height / 2 }
        : within(this.spring.at, size.width, size.height, scene.width, scene.height);
    return {
      view: this.view,
      centre,
      dim: this.dim,
      subject: this.view === "local" ? this.subject : null,
    };
  }

  private get dim(): number {
    const dip = this.dip;
    if (dip === null) return 0;
    if (dip.phase === "out") return Math.min(dip.t / DIP_OUT_S, 1);
    if (dip.phase === "wait" || dip.phase === "dark") return 1;
    return Math.max(1 - dip.t / DIP_IN_S, 0);
  }

  /** Dip to dark, do `then` in the dark, and come back once the view is painted. */
  private cut(then: (scene: Scene) => void): void {
    // From partway back up, the way down starts as dark as the picture is.
    const t = this.dip === null ? 0 : this.dim * DIP_OUT_S;
    this.dip = { phase: "out", t, then };
  }

  private go(view: ViewName): void {
    this.going = view;
    this.cut((scene) => {
      this.going = null;
      this.view = view;
      this.walking.reset();
      // A visit ends with its view; an entry already out when the local view comes is not visited.
      this.visit = null;
      this.visited = scene.place?.entry ?? null;
      if (view === "map") {
        this.motion = "still";
        this.subject = null;
      } else if (view === "middle") {
        this.subject = null;
        this.spring.options = DRIFTING;
        this.spring.snap(this.upcomingPlace ?? this.landPlace(scene, null));
        this.upcomingPlace = null;
        this.startDrift(scene);
      } else {
        this.spring.options = FOLLOWING;
        this.motion = "follow";
        const next = this.takeUpcoming(scene, null) ?? this.choose(scene, null);
        this.subject = next?.id ?? null;
        this.follow = this.followTime();
        this.spring.snap(next ?? { x: scene.width / 2, y: scene.height / 2 });
      }
    });
  }

  private moveDip(dtS: number, scene: Scene): void {
    const dip = this.dip;
    if (dip === null) return;
    dip.t += dtS;
    if (dip.phase === "out" && dip.t >= DIP_OUT_S) {
      // Fully dark on the screen before the cut (R5, the owner on the board: the new view's
      // lay-out held up the frame of the cut, and the last frame shown, not quite dark,
      // stayed with what was drawn before showing through it).
      this.dip = { phase: "dark", t: 0, then: dip.then };
    } else if (dip.phase === "dark") {
      this.darkFrames += 1;
      if (this.darkFrames < DARK_FRAMES) return;
      this.darkFrames = 0;
      dip.then(scene);
      this.dip = { phase: "wait", t: 0, then: dip.then };
    } else if (dip.phase === "wait" && (scene.ready || dip.t >= WAIT_MAX_S)) {
      this.dip = { phase: "in", t: 0, then: dip.then };
    } else if (dip.phase === "in" && dip.t >= DIP_IN_S) {
      this.dip = null;
    }
  }

  /** Move the camera within its view. */
  private film(dtS: number, scene: Scene): void {
    if (this.view === "middle") this.drift(dtS, scene);
    else if (this.view === "local") this.track(dtS, scene);
  }

  // The middle view.

  private startDrift(scene: Scene): void {
    const from = this.spring.at;
    this.carrot.x = from.x;
    this.carrot.y = from.y;
    const to = this.landPlace(scene, from);
    this.place.x = to.x;
    this.place.y = to.y;
    this.motion = "drift";
  }

  private drift(dtS: number, scene: Scene): void {
    if (this.motion === "linger") {
      this.linger -= dtS;
      if (this.linger <= 0) this.startDrift(scene);
    } else {
      const dx = this.place.x - this.carrot.x;
      const dy = this.place.y - this.carrot.y;
      const left = Math.hypot(dx, dy);
      const stride = DRIFT_SPEED * dtS;
      if (left <= stride) {
        this.carrot.x = this.place.x;
        this.carrot.y = this.place.y;
        this.motion = "linger";
        this.linger = between(this.random, LINGER_MIN_S, LINGER_MAX_S);
      } else {
        this.carrot.x += (dx / left) * stride;
        this.carrot.y += (dy / left) * stride;
      }
    }
    this.spring.step(this.carrot, dtS);
  }

  /**
   * A place on land, within reach of `from` (anywhere for null), whose view does not
   * look off the world's edge. Failing land, anywhere.
   */
  private landPlace(scene: Scene, from: Point | null): Point {
    const { width, height } = this.sizes.middle;
    let place: Point = { x: scene.width / 2, y: scene.height / 2 };
    for (let attempt = 0; attempt < DRIFT_TRIES; attempt++) {
      let x: number;
      let y: number;
      if (from === null) {
        x = this.random() * scene.width;
        y = this.random() * scene.height;
      } else {
        const angle = this.random() * 2 * Math.PI;
        const reach = between(this.random, DRIFT_MIN_CELLS, DRIFT_MAX_CELLS);
        x = from.x + Math.cos(angle) * reach;
        y = from.y + Math.sin(angle) * reach;
      }
      place = within({ x, y }, width, height, scene.width, scene.height);
      if (scene.isLand(place.x, place.y)) return place;
    }
    return place;
  }

  // The local view.

  private followTime(): number {
    return between(this.random, this.timings.followMinS, this.timings.followMaxS);
  }

  /**
   * The next animal to follow: a species drawn at random among those with an animal
   * awake (all of them if every one sleeps), then one of its animals, awake if it can
   * be, and not `current` while there is anyone else.
   */
  /**
   * Choose the animal the local view will follow next, and the place the middle view will
   * come down on, ahead of time (R5, the optimization plan: their ground is painted while
   * the camera is elsewhere, `upcoming` and `upcomingMiddle`, so that a view finds it
   * painted).
   */
  private lookAhead(scene: Scene): void {
    // The middle view's place too, once the land is there to choose it on.
    if (this.upcomingPlace === null && this.view !== "middle" && this.going !== "middle") {
      const place = this.landPlace(scene, null);
      if (scene.isLand(place.x, place.y)) this.upcomingPlace = place;
    }
    const current = this.view === "local" ? this.subject : null;
    const known =
      this.upcomingId === null ? undefined : scene.subjects.find((s) => s.id === this.upcomingId);
    if (known !== undefined && known.id !== current && !known.torpid) {
      this.upcomingAt = { x: known.x, y: known.y };
      return;
    }
    const next = this.choose(scene, current);
    this.upcomingId = next?.id ?? null;
    this.upcomingAt = next === null ? null : { x: next.x, y: next.y };
  }

  /** The animal chosen ahead (`lookAhead`), if it is still about and awake; it is chosen anew after. */
  private takeUpcoming(scene: Scene, current: number | null): Subject | null {
    const id = this.upcomingId;
    this.upcomingId = null;
    this.upcomingAt = null;
    if (id === null || id === current) return null;
    const subject = scene.subjects.find((s) => s.id === id);
    return subject === undefined || subject.torpid ? null : subject;
  }

  /** Where the animal the local view will follow next is now (`lookAhead`); null if none chosen. */
  get upcoming(): Point | null {
    return this.upcomingAt;
  }

  /** Where the middle view will come down next (`lookAhead`); null if not chosen yet. */
  get upcomingMiddle(): Point | null {
    return this.upcomingPlace;
  }

  private choose(scene: Scene, current: number | null): Subject | null {
    const others = scene.subjects.filter((subject) => subject.id !== current);
    const pool = others.length > 0 ? others : scene.subjects;
    if (pool.length === 0) return null;
    const awake = pool.filter((subject) => !subject.torpid);
    const candidates = awake.length > 0 ? awake : pool;
    // Species in the order first met: the draw does not depend on how a Map orders keys.
    const species: number[] = [];
    for (const subject of candidates) {
      if (!species.includes(subject.species)) species.push(subject.species);
    }
    const chosen = species[Math.floor(this.random() * species.length)];
    const members = candidates.filter((subject) => subject.species === chosen);
    return members[Math.floor(this.random() * members.length)] ?? null;
  }

  private track(dtS: number, scene: Scene): void {
    // While the camera is away, the time on the animal is paused.
    if (this.visiting(dtS, scene)) return;
    this.follow -= dtS;
    let subject = scene.subjects.find((candidate) => candidate.id === this.subject) ?? null;
    if (subject === null || (this.follow <= 0 && this.dip === null)) {
      // Its time is up, or it died: on to the next.
      const next = this.takeUpcoming(scene, this.subject) ?? this.choose(scene, this.subject);
      this.follow = this.followTime();
      if (next === null) {
        this.subject = null;
        return;
      }
      const reach = GLIDE_WIDTHS * this.sizes.local.width;
      const far = Math.hypot(next.x - this.spring.at.x, next.y - this.spring.at.y) > reach;
      if (far && this.dip === null) {
        // Keep on the one in sight, if it lives, until the picture is dark.
        this.cut(() => {
          this.subject = next.id;
          this.walking.reset();
          this.motion = "follow";
          this.spring.options = FOLLOWING;
          const now = scene.subjects.find((candidate) => candidate.id === next.id) ?? next;
          this.spring.snap(now);
        });
        if (subject === null) return;
      } else {
        this.subject = next.id;
        this.walking.reset();
        subject = next;
        if (far) {
          this.spring.snap(next);
        } else {
          this.motion = "glide";
          this.spring.options = GLIDING;
        }
      }
    }
    if (subject === null) return;
    const velocity = this.walking.update(subject, dtS);
    if (this.motion === "return" && this.dip !== null) return;
    if (this.motion === "glide" || this.motion === "return") {
      this.spring.step(subject, dtS);
      if (
        Math.hypot(subject.x - this.spring.at.x, subject.y - this.spring.at.y) < GLIDE_DONE_CELLS
      ) {
        this.motion = "follow";
        this.spring.options = FOLLOWING;
      }
      return;
    }
    this.spring.step(framing(this.spring.at, subject, velocity, LEAD_S, DEAD_ZONE_CELLS), dtS);
  }

  /**
   * Visit the place of the entry on the scroll, if there is one to visit; say whether the
   * camera is away from its animal. A visit starts only out of a dip, goes on to the next
   * entry's place if one comes while it lasts (each entry is visited in turn), and ends
   * when no entry is out: the camera goes back to the animal it left (gliding, or cutting
   * if the animal is far), and follows it again.
   */
  private visiting(dtS: number, scene: Scene): boolean {
    const wanted = scene.place ?? null;
    const fresh = wanted !== null && wanted.entry !== this.visited;
    if (this.visit === null && (!fresh || this.dip !== null)) return false;
    if (fresh && this.dip === null) {
      // To a new place: glided to if it is near, cut to if not.
      this.visited = wanted.entry;
      const size = this.sizes.local;
      const at = within(wanted, size.width, size.height, scene.width, scene.height);
      const visit = { entry: wanted.entry, x: at.x, y: at.y };
      this.visit = visit;
      this.motion = "visit";
      this.spring.options = VISITING;
      if (this.far(visit, VISIT_GLIDE_WIDTHS)) {
        this.cut(() => {
          if (this.visit === visit) this.spring.snap(visit);
        });
      }
    }
    const visit = this.visit;
    if (visit === null) return false;
    if (wanted === null && this.dip === null) {
      // The entry is read: back to the animal left, which may have walked on (or died:
      // then on to the next, as when one dies in sight).
      this.visit = null;
      this.walking.reset();
      const subject = scene.subjects.find((candidate) => candidate.id === this.subject);
      if (subject === undefined) return false;
      this.motion = "return";
      this.spring.options = VISITING;
      if (this.far(subject, VISIT_GLIDE_WIDTHS)) {
        // Held where it is until the picture is dark (`track`), then put on the animal.
        this.cut(() => {
          this.motion = "follow";
          this.spring.options = FOLLOWING;
          const now = scene.subjects.find((candidate) => candidate.id === subject.id);
          this.spring.snap(now ?? subject);
        });
      }
      return false;
    }
    // Held still in a dip (it may be cutting to the place), eased there otherwise.
    if (this.dip === null) this.spring.step(visit, dtS);
    return true;
  }

  /** Whether `point` is further from the camera than `widths` local views' widths. */
  private far(point: Point, widths: number): boolean {
    const reach = widths * this.sizes.local.width;
    return Math.hypot(point.x - this.spring.at.x, point.y - this.spring.at.y) > reach;
  }
}

function between(random: Random, from: number, to: number): number {
  return from + random() * (to - from);
}
