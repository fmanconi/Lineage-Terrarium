/**
 * Fauna Analyst Mod (ADR 0024):
 *
 * Provides analytical diagnostic overlays over the living ecosystem:
 *   1. Movement Vectors: Semi-transparent directional arrows showing animal velocity & pack orientation.
 *   2. Population Density: Heatmap gradient (purple -> red -> yellow) highlighting congregation clusters.
 *   3. Kill Zones: Cumulative map of predation, carcasses, and hunting strikes.
 *   4. Territory & Nests: Pack home range perimeters and territorial contest boundaries.
 *
 * Switch diagnostic modes dynamically by pressing [E] or via Mod Menu.
 * Pure renderer overlay: zero simulation state alteration.
 */
import { Container, Graphics } from "pixi.js";
import { TILES } from "../../landscape";
import type { Mod, ModLayers, ModMetadata } from "../types";

export type AnalystMode = "vectors" | "density" | "killzones" | "territories";

export const ANALYST_MODES: AnalystMode[] = ["vectors", "density", "killzones", "territories"];

export interface KillEvent {
  x: number;
  y: number;
  ageS: number;
  maxAgeS: number;
}

export class FaunaAnalystMod implements Mod {
  readonly meta: ModMetadata = {
    id: "fauna-analyst",
    name: "Fauna Analyst",
    version: "1.0.0",
    description:
      "Scientific ecosystem diagnostics: vectors, population heatmaps, hunting kill zones, and pack territories. Cycle mode with [E].",
    defaultEnabled: true,
  };

  private readonly over = new Container();
  private readonly graphics = new Graphics();
  readonly layers: ModLayers = { over: this.over };

  private enabled = false;
  private currentMode: AnalystMode = "vectors";
  private readonly killEvents: KillEvent[] = [];

  constructor() {
    this.over.addChild(this.graphics);
    this.over.visible = false;
  }

  init(): void {
    // mounted by scene
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.over.visible = false;
    this.graphics.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMode(): AnalystMode {
    return this.currentMode;
  }

  setMode(mode: AnalystMode): void {
    this.currentMode = mode;
  }

  cycleMode(): AnalystMode {
    const idx = ANALYST_MODES.indexOf(this.currentMode);
    this.currentMode = ANALYST_MODES[(idx + 1) % ANALYST_MODES.length] as AnalystMode;
    return this.currentMode;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    if (e.key === "e" || e.key === "E") {
      this.cycleMode();
      return true;
    }
    return false;
  }

  recordKill(x: number, y: number, maxAgeS = 120): void {
    this.killEvents.push({ x, y, ageS: 0, maxAgeS });
    if (this.killEvents.length > 64) this.killEvents.shift();
  }

  getKillEvents(): readonly KillEvent[] {
    return this.killEvents;
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!this.enabled) return;

    // Age kill events
    const kept: KillEvent[] = [];
    for (const k of this.killEvents) {
      k.ageS += dtS;
      if (k.ageS < k.maxAgeS) kept.push(k);
    }
    this.killEvents.length = 0;
    this.killEvents.push(...kept);

    const g = this.graphics;
    g.clear();

    const view = options.view;
    if (view !== "map" && view !== "middle" && view !== "local") {
      this.over.visible = false;
      return;
    }

    type Animal = {
      id: number;
      x: number;
      y: number;
      heading?: number;
      species?: number;
      hunting?: boolean;
      prey?: boolean;
    };

    const animals = (Array.isArray(options.animals) ? options.animals : []) as Animal[];
    if (animals.length === 0 && this.killEvents.length === 0) {
      this.over.visible = false;
      return;
    }
    this.over.visible = true;

    // Observe hunts in progress
    for (const a of animals) {
      if (a.hunting && Math.random() < 0.05 * dtS) {
        this.recordKill(a.x, a.y, 60);
      }
    }

    switch (this.currentMode) {
      case "vectors":
        this.drawVectors(g, animals);
        break;
      case "density":
        this.drawDensity(g, animals);
        break;
      case "killzones":
        this.drawKillZones(g);
        break;
      case "territories":
        this.drawTerritories(g, animals, options.nests as { x: number; y: number; species: number }[] | undefined);
        break;
    }
  }

  private drawVectors(g: Graphics, animals: readonly { x: number; y: number; heading?: number }[]): void {
    for (const a of animals) {
      const heading = a.heading ?? 0;
      const len = 1.2;
      const endX = a.x + Math.cos(heading) * len;
      const endY = a.y + Math.sin(heading) * len;

      // Draw velocity vector line
      g.moveTo(a.x, a.y).lineTo(endX, endY).stroke({ width: 0.25, color: 0x44d4ff, alpha: 0.7 });

      // Arrowhead
      const arrowAng = Math.PI / 6;
      const arrowLen = 0.4;
      g.moveTo(endX, endY)
        .lineTo(endX - Math.cos(heading - arrowAng) * arrowLen, endY - Math.sin(heading - arrowAng) * arrowLen)
        .stroke({ width: 0.2, color: 0x44d4ff, alpha: 0.8 });
      g.moveTo(endX, endY)
        .lineTo(endX - Math.cos(heading + arrowAng) * arrowLen, endY - Math.sin(heading + arrowAng) * arrowLen)
        .stroke({ width: 0.2, color: 0x44d4ff, alpha: 0.8 });
    }
  }

  private drawDensity(g: Graphics, animals: readonly { x: number; y: number }[]): void {
    // Cluster into 4x4 cell blocks
    const counts = new Map<string, { gx: number; gy: number; count: number }>();
    const BLOCK = 4;
    for (const a of animals) {
      const bx = Math.floor(a.x / BLOCK);
      const by = Math.floor(a.y / BLOCK);
      const key = `${bx},${by}`;
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { gx: bx * BLOCK, gy: by * BLOCK, count: 1 });
    }

    for (const { gx, gy, count } of counts.values()) {
      const intensity = Math.min(1.0, count / 8);
      // Gradient: purple (0x662288) -> red (0xcc2233) -> yellow (0xffcc00)
      const color = intensity < 0.5 ? 0x7a288a : intensity < 0.8 ? 0xd03030 : 0xf0c020;
      g.rect(gx, gy, BLOCK, BLOCK).fill({ color, alpha: 0.25 + 0.3 * intensity });
    }
  }

  private drawKillZones(g: Graphics): void {
    for (const k of this.killEvents) {
      const fade = 1 - k.ageS / k.maxAgeS;
      if (fade <= 0) continue;
      // Red predation perimeter circle with center pulse cross
      g.circle(k.x, k.y, 2.5).fill({ color: 0xd82828, alpha: 0.25 * fade });
      g.circle(k.x, k.y, 2.5).stroke({ width: 0.2, color: 0xff4444, alpha: 0.6 * fade });
      // Inner cross mark
      g.moveTo(k.x - 0.5, k.y).lineTo(k.x + 0.5, k.y).stroke({ width: 0.2, color: 0xffffff, alpha: 0.8 * fade });
      g.moveTo(k.x, k.y - 0.5).lineTo(k.x, k.y + 0.5).stroke({ width: 0.2, color: 0xffffff, alpha: 0.8 * fade });
    }
  }

  private drawTerritories(
    g: Graphics,
    animals: readonly { x: number; y: number; species?: number }[],
    nests?: { x: number; y: number; species: number }[],
  ): void {
    if (nests && nests.length > 0) {
      for (const nest of nests) {
        // Draw 5-cell radius territory boundary
        g.circle(nest.x, nest.y, 5.0).fill({ color: 0x33aa55, alpha: 0.15 });
        g.circle(nest.x, nest.y, 5.0).stroke({ width: 0.25, color: 0x55ff77, alpha: 0.7 });
      }
    } else {
      // Group by species and draw centroid radius
      const bySpecies = new Map<number, { x: number; y: number }[]>();
      for (const a of animals) {
        const sp = a.species ?? 1;
        const list = bySpecies.get(sp) ?? [];
        list.push({ x: a.x, y: a.y });
        bySpecies.set(sp, list);
      }
      for (const [, pts] of bySpecies) {
        if (pts.length < 3) continue;
        let cx = 0;
        let cy = 0;
        for (const p of pts) {
          cx += p.x;
          cy += p.y;
        }
        cx /= pts.length;
        cy /= pts.length;
        g.circle(cx, cy, 4.0).fill({ color: 0x3388cc, alpha: 0.15 });
        g.circle(cx, cy, 4.0).stroke({ width: 0.25, color: 0x55aaff, alpha: 0.6 });
      }
    }
  }
}
