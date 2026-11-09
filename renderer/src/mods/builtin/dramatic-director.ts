/**
 * Event Camera (ADR 0024): an intelligent documentary camera director.
 *
 * Rather than wandering blindly or lingering for 5 minutes on an idle sleeping creature,
 * this camera actively scans the emergent simulation events and dynamically frames:
 *   - Rare mutations & new species discoveries (Score 100)
 *   - Cataclysms & environmental hazards (Score 95)
 *   - New births emerging beside mothers / egg broods (Score 85)
 *   - Territorial clashes and pack skirmishes (Score 80)
 *   - Predation and hunting pursuits (Score 82)
 *   - Courtship & mating pairs (Score 70)
 *   - Notable deaths & remains formation (Score 60)
 *
 * Displays a subtle, elegant pixel-art documentary badge describing what caught
 * the camera's attention, and dynamically modulates shot durations.
 */
import { draw, measure } from "../../pixelfont";
import type { Scene, Subject } from "../../director";
import type { Mod, ModContext, ModMetadata } from "../types";

export type DramaticEventType =
  "mutation" | "disaster" | "birth" | "hunt" | "clash" | "courtship" | "death";

export interface DramaticEvent {
  id: string;
  type: DramaticEventType;
  subjectId: number;
  x: number;
  y: number;
  score: number;
  label: string;
  timestamp: number;
  durationS: number;
}

const EVENT_TTL_S = 35;
const BADGE_DISPLAY_S = 6;
const FADE_S = 0.5;

// Frame and card colors matching Lineage UI
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const CARD = 0x241432;
const CARD_EDGE = 0x4a2a62;
const TEXT_COLOUR = 0xfaf3e1;
const SHADOW_COLOUR = 0x000000;
const SHADOW_ALPHA = 120;

export class DramaticDirectorEngine {
  private active = false;
  private readonly events: DramaticEvent[] = [];
  private activeEvent: DramaticEvent | null = null;
  private activeLabel: string | null = null;
  private labelTimer = 0;
  private lastSubjectId: number | null = null;

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.events.length = 0;
      this.activeEvent = null;
      this.activeLabel = null;
      this.labelTimer = 0;
    }
  }

  /** Current active headline label to show on the documentary HUD badge, or null. */
  currentLabel(): string | null {
    return this.labelTimer > 0 ? this.activeLabel : null;
  }

  /** Queue a dramatic event into the director's radar. */
  recordEvent(event: Omit<DramaticEvent, "timestamp">): void {
    if (!this.active) return;
    const now = performance.now() / 1000;
    // Discard duplicates for the same subject within 5s
    const dup = this.events.find(
      (e) => e.type === event.type && e.subjectId === event.subjectId && now - e.timestamp < 5,
    );
    if (dup !== undefined) return;

    this.events.push({ ...event, timestamp: now });
    // Keep radar pruned to newest 25 events
    if (this.events.length > 25) {
      this.events.splice(0, this.events.length - 25);
    }
  }

  /** Register a newly born creature (and flag if it carries rare gene mutations). */
  recordBirth(
    id: number,
    parentId: number | undefined,
    slots = 0,
    species = 0,
    x = 0,
    y = 0,
  ): void {
    if (slots > 0) {
      this.recordEvent({
        id: `mut-${id}-${Math.round(performance.now())}`,
        type: "mutation",
        subjectId: id,
        x,
        y,
        score: 100,
        label: species > 0 ? "Nuova Mutazione Ereditaria" : "Nuova Mutazione Rara",
        durationS: 45,
      });
    } else {
      this.recordEvent({
        id: `birth-${id}-${Math.round(performance.now())}`,
        type: "birth",
        subjectId: id,
        x,
        y,
        score: 85,
        label: parentId !== undefined ? "Nuova Nascita" : "Nuova Creatura",
        durationS: 38,
      });
    }
  }

  /** Register a territorial clash or pack skirmish. */
  recordClash(idA: number, idB: number, x: number, y: number): void {
    this.recordEvent({
      id: `clash-${idA}-${idB}-${Math.round(performance.now())}`,
      type: "clash",
      subjectId: idA,
      x,
      y,
      score: 80,
      label: "Scontro tra branchi",
      durationS: 40,
    });
  }

  /** Register courtship / mating pair. */
  recordCourtship(idA: number, idB: number, x: number, y: number): void {
    this.recordEvent({
      id: `court-${idA}-${idB}-${Math.round(performance.now())}`,
      type: "courtship",
      subjectId: idA,
      x,
      y,
      score: 70,
      label: "Corteggiamento",
      durationS: 35,
    });
  }

  /** Register a predation pursuit. */
  recordHunt(hunterId: number, preyId: number, x: number, y: number): void {
    this.recordEvent({
      id: `hunt-${hunterId}-${preyId}-${Math.round(performance.now())}`,
      type: "hunt",
      subjectId: hunterId,
      x,
      y,
      score: 82,
      label: "Caccia e Predazione",
      durationS: 38,
    });
  }

  /** Register an animal death. */
  recordDeath(id: number, cause: string, killerId?: number, x = 0, y = 0): void {
    if (cause === "killed" && killerId !== undefined) {
      this.recordEvent({
        id: `kill-${id}-${Math.round(performance.now())}`,
        type: "hunt",
        subjectId: killerId,
        x,
        y,
        score: 82,
        label: "Predazione Riuscita",
        durationS: 35,
      });
    } else {
      this.recordEvent({
        id: `death-${id}-${Math.round(performance.now())}`,
        type: "death",
        subjectId: id,
        x,
        y,
        score: 60,
        label: cause === "starved" ? "Fine Vita: Inedia" : "Fine Ciclo Naturale",
        durationS: 32,
      });
    }
  }

  /** Register a natural cataclysm (volcano, meteor, fire). */
  recordDisaster(kind: string, x: number, y: number): void {
    const label =
      kind === "volcano"
        ? "Eruzione Vulcanica"
        : kind === "crater"
          ? "Impatto di Meteorite"
          : kind === "earthquake"
            ? "Faglia Sismica"
            : "Fulmine e Incendio";
    this.recordEvent({
      id: `disaster-${kind}-${Math.round(performance.now())}`,
      type: "disaster",
      subjectId: -1,
      x,
      y,
      score: 95,
      label,
      durationS: 48,
    });
  }

  /** Choose the next subject based on dramatic scoring. */
  chooseNext(scene: Scene, without: number | null, random: () => number): Subject | null {
    if (!this.active) return null;
    const now = performance.now() / 1000;
    this.prune(now);

    // Filter events where the animal is alive or can be located by proximity
    const valid = this.events.filter((e) => {
      if (e.subjectId === without) return false;
      if (e.subjectId > 0) return scene.subjects.some((s) => s.id === e.subjectId);
      return scene.subjects.length > 0;
    });

    if (valid.length > 0) {
      // Pick the highest scoring event (with slight jitter for variety among equals)
      valid.sort((a, b) => b.score - a.score + (random() * 5 - 2.5));
      const chosen = valid[0];
      if (chosen !== undefined) {
        let subject: Subject | null = null;
        if (chosen.subjectId > 0) {
          subject = scene.subjects.find((s) => s.id === chosen.subjectId) ?? null;
        } else {
          let bestDist = Infinity;
          for (const s of scene.subjects) {
            if (s.id === without) continue;
            const d = Math.hypot(s.x - chosen.x, s.y - chosen.y);
            if (d < bestDist) {
              bestDist = d;
              subject = s;
            }
          }
        }
        if (subject !== null) {
          this.activeEvent = chosen;
          this.activeLabel = chosen.label;
          this.labelTimer = BADGE_DISPLAY_S;
          this.lastSubjectId = subject.id;
          const idx = this.events.indexOf(chosen);
          if (idx >= 0) this.events.splice(idx, 1);
          return subject;
        }
      }
    }

    // Fallback: pick the most lively or interesting creature available
    const candidates = scene.subjects.filter((s) => s.id !== without);
    if (candidates.length === 0) return null;

    // Prefer active (non-torpid) creatures with narrative continuity (neighbors / same species)
    const activeCandidates = candidates.filter((s) => !s.torpid);
    let pool = activeCandidates.length > 0 ? activeCandidates : candidates;
    const prev = without !== null ? scene.subjects.find((s) => s.id === without) : null;
    if (prev && activeCandidates.length > 1) {
      const near = activeCandidates.filter(
        (s) => Math.hypot(s.x - prev.x, s.y - prev.y) <= 8 || s.species === prev.species,
      );
      if (near.length > 0) pool = near;
    }

    const chosen = pool[Math.floor(random() * pool.length)] ?? null;
    if (chosen !== null) {
      this.activeEvent = null;
      this.activeLabel = chosen.species > 0 ? `Osservazione Fauna #${chosen.species}` : null;
      this.labelTimer = chosen.species > 0 ? 3.5 : 0;
      this.lastSubjectId = chosen.id;
    }
    return chosen;
  }

  /** Returns an urgent event (score >= 85) if one is waiting and differs from the current shot. */
  peekUrgent(scene: Scene, currentSubjectId: number | null): DramaticEvent | null {
    if (!this.active) return null;
    const now = performance.now() / 1000;
    this.prune(now);
    const urgent = this.events.find((e) => {
      if (e.score < 85) return false;
      if (e.subjectId === currentSubjectId) return false;
      if (e.subjectId > 0) return scene.subjects.some((s) => s.id === e.subjectId);
      return scene.subjects.length > 0;
    });
    return urgent ?? null;
  }

  /** Determine dynamic follow time for the chosen shot. */
  currentFollowTime(subject: Subject | null, random: () => number): number {
    if (!this.active) return 300;
    if (this.activeEvent !== null) {
      return this.activeEvent.durationS + (random() * 6 - 3);
    }
    if (subject?.torpid) {
      return 12 + random() * 4; // Short stay on sleeping animals (12-16s)
    }
    // Dynamic normal shot: 30 to 45 seconds (extended documentary pacing)
    return 30 + random() * 15;
  }

  update(dtS: number): void {
    if (this.labelTimer > 0) {
      this.labelTimer = Math.max(0, this.labelTimer - dtS);
    }
  }

  private prune(now: number): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event !== undefined && now - event.timestamp > EVENT_TTL_S) {
        this.events.splice(i, 1);
      }
    }
  }
}

export const dramaticDirector = new DramaticDirectorEngine();

export function isDramaticDirectorActive(): boolean {
  return dramaticDirector.isActive();
}

export function setDramaticDirectorActive(active: boolean): void {
  dramaticDirector.setActive(active);
}

/**
 * Pixel-art documentary HUD toast badge rendered when a dramatic event is followed.
 */
export class DramaticBadge {
  readonly element = document.createElement("canvas");
  private paintedText: string | null = null;
  private alpha = 0;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    style.zIndex = "15";
    this.element.dataset.testid = "dramatic-badge";
  }

  update(dtS: number): void {
    const label = dramaticDirector.currentLabel();
    const shouldShow = dramaticDirector.isActive() && label !== null;

    if (shouldShow) {
      this.alpha = Math.min(1, this.alpha + dtS / FADE_S);
    } else {
      this.alpha = Math.max(0, this.alpha - dtS / FADE_S);
    }

    if (this.alpha <= 0) {
      this.element.style.display = "none";
      return;
    }

    if (label !== null && label !== this.paintedText) {
      this.paint(label);
    }

    this.element.style.opacity = this.alpha.toFixed(2);
    this.element.style.display = "block";
  }

  private paint(text: string): void {
    this.paintedText = text;
    const textW = measure(text);
    const padX = 7;
    const padY = 4;
    const width = textW + padX * 2 + 2; // +2 for shadow
    const height = 15;

    this.element.width = width;
    this.element.height = height;

    const share = (v: number, total: number): string => `${(100 * v) / total}%`;
    this.element.style.width = share(width, this.screenWidth);
    this.element.style.height = share(height, this.screenHeight);

    // Center horizontally near top of screen
    const left = Math.round((this.screenWidth - width) / 2);
    const top = 6;
    this.element.style.left = share(left, this.screenWidth);
    this.element.style.top = share(top, this.screenHeight);

    const rgba = new Uint8ClampedArray(width * height * 4);
    const put = (x: number, y: number, colour: number, a = 255): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const at = 4 * (y * width + x);
      rgba[at] = (colour >> 16) & 255;
      rgba[at + 1] = (colour >> 8) & 255;
      rgba[at + 2] = colour & 255;
      rgba[at + 3] = a;
    };

    const cardW = width - 1;
    const cardH = height - 1;

    // Soft drop shadow
    for (let y = 1; y < height; y++) {
      for (let x = 1; x < width; x++) {
        put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
      }
    }

    // Outer frame & card background
    for (let y = 0; y < cardH; y++) {
      for (let x = 0; x < cardW; x++) {
        const ring = Math.min(x, y, cardW - 1 - x, cardH - 1 - y);
        if (ring === 0) put(x, y, FRAME_EDGE);
        else if (ring === 1) put(x, y, y === 1 ? FRAME_LIT : CARD_EDGE);
        else put(x, y, CARD);
      }
    }

    // Pixel art text
    draw(text, padX, padY, (px, py) => put(px, py, TEXT_COLOUR));

    const ctx = this.element.getContext("2d");
    if (ctx) {
      ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    }
  }
}

export class DramaticDirectorMod implements Mod {
  readonly meta: ModMetadata = {
    id: "dramatic-director",
    name: "Event Camera",
    version: "1.0.0",
    description:
      "The camera goes to births, hunts, face-offs, deaths and rare genes as they happen.",
    defaultEnabled: true,
  };

  private badge: DramaticBadge | null = null;

  init(ctx: ModContext): void {
    if (typeof document !== "undefined") {
      this.badge = new DramaticBadge(ctx.width, ctx.height);
      ctx.frame?.appendChild?.(this.badge.element);
    }
  }

  enable(): void {
    setDramaticDirectorActive(true);
  }

  disable(): void {
    setDramaticDirectorActive(false);
  }

  isEnabled(): boolean {
    return isDramaticDirectorActive();
  }

  update(dtS: number): void {
    dramaticDirector.update(dtS);
    this.badge?.update(dtS);
  }
}
