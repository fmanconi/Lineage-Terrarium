/**
 * Explorer & Wildlife CCTV Mod (ADR 0024):
 *
 * Provides free manual exploration and static camera bookmarks:
 *   1. Free Roam: WASD / Arrow keys or pointer dragging moves the camera view freely,
 *      releasing it from automatic director constraints.
 *   2. CCTV Bookmarks (4 slots):
 *      - Shift + [1..4]: Save the current world coordinates into a CCTV preset (Cam 1..4).
 *      - [1..4]: Instantly glide to that CCTV preset position.
 *   3. Patrol Mode: Cycles periodically between all saved CCTV bookmark positions.
 *
 * Renderer-only: zero sim/ impact.
 */
import type { StorageLike } from "../../settings";
import type { Mod, ModContext, ModMetadata } from "../types";

export interface CameraBookmark {
  x: number;
  y: number;
}

export const CCTV_STORAGE_KEY = "lineage_cctv_bookmarks_v1";

export class ExplorerCctvMod implements Mod {
  readonly meta: ModMetadata = {
    id: "explorer-cctv",
    name: "Explorer & Wildlife CCTV",
    version: "1.0.0",
    description:
      "Manual camera controls (WASD/arrows/drag), 4 CCTV bookmarks (Shift+1..4 to save, 1..4 to visit), and Patrol mode.",
    defaultEnabled: true,
  };

  private enabled = false;
  private storage: StorageLike | null = null;
  private bookmarks = new Map<number, CameraBookmark>();
  private freeRoam = false;
  private patrolMode = false;
  private patrolTimer = 0;
  private currentPatrolIndex = 0;
  private targetPos: { x: number; y: number } | null = null;
  private currentPos: { x: number; y: number } = { x: 50, y: 50 };

  constructor() {}

  init(ctx: ModContext): void {
    this.storage = ctx.storage;
    this.loadBookmarks();
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.freeRoam = false;
    this.patrolMode = false;
    this.targetPos = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isFreeRoam(): boolean {
    return this.freeRoam;
  }

  setFreeRoam(active: boolean): void {
    this.freeRoam = active;
    if (!active) this.targetPos = null;
  }

  isPatrolMode(): boolean {
    return this.patrolMode;
  }

  setPatrolMode(active: boolean): void {
    this.patrolMode = active;
    this.patrolTimer = 0;
  }

  togglePatrolMode(): boolean {
    this.setPatrolMode(!this.patrolMode);
    return this.patrolMode;
  }

  saveBookmark(slot: number, x: number, y: number): void {
    if (slot < 1 || slot > 4) return;
    this.bookmarks.set(slot, { x, y });
    this.persistBookmarks();
  }

  getBookmark(slot: number): CameraBookmark | undefined {
    return this.bookmarks.get(slot);
  }

  getAllBookmarks(): ReadonlyMap<number, CameraBookmark> {
    return this.bookmarks;
  }

  recallBookmark(slot: number): CameraBookmark | undefined {
    const mark = this.bookmarks.get(slot);
    if (mark) {
      this.freeRoam = true;
      this.targetPos = { x: mark.x, y: mark.y };
      return mark;
    }
    return undefined;
  }

  getTargetPosition(): { x: number; y: number } | null {
    return this.targetPos;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;

    // Shift + 1..4 -> save CCTV preset
    if (e.shiftKey && ["1", "2", "3", "4"].includes(e.key)) {
      const slot = parseInt(e.key, 10);
      this.saveBookmark(slot, this.currentPos.x, this.currentPos.y);
      return true;
    }

    // 1..4 (without shift) -> recall CCTV preset
    if (!e.shiftKey && !e.ctrlKey && !e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
      const slot = parseInt(e.key, 10);
      if (this.bookmarks.has(slot)) {
        this.recallBookmark(slot);
        return true;
      }
    }

    // WASD or Arrow pan
    const step = 2.0;
    const k = e.key.toLowerCase();
    if (["w", "arrowup"].includes(k)) {
      this.moveManual(0, -step);
      return true;
    }
    if (["s", "arrowdown"].includes(k)) {
      this.moveManual(0, step);
      return true;
    }
    if (["a", "arrowleft"].includes(k)) {
      this.moveManual(-step, 0);
      return true;
    }
    if (["d", "arrowright"].includes(k)) {
      this.moveManual(step, 0);
      return true;
    }

    return false;
  }

  private moveManual(dx: number, dy: number): void {
    this.freeRoam = true;
    const base = this.targetPos ?? this.currentPos;
    this.targetPos = {
      x: Math.max(5, Math.min(250, base.x + dx)),
      y: Math.max(5, Math.min(145, base.y + dy)),
    };
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!this.enabled) return;

    if (typeof options.camX === "number" && typeof options.camY === "number") {
      this.currentPos = { x: options.camX, y: options.camY };
    }

    // Patrol logic: cycle through bookmarks every 18 seconds
    if (this.patrolMode && this.bookmarks.size > 0) {
      this.patrolTimer += dtS;
      if (this.patrolTimer >= 18) {
        this.patrolTimer = 0;
        const slots = [...this.bookmarks.keys()].sort((a, b) => a - b);
        this.currentPatrolIndex = (this.currentPatrolIndex + 1) % slots.length;
        const nextSlot = slots[this.currentPatrolIndex];
        if (nextSlot !== undefined) {
          this.recallBookmark(nextSlot);
        }
      }
    }
  }

  private loadBookmarks(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CCTV_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        for (const [k, v] of Object.entries(parsed as Record<string, { x: number; y: number }>)) {
          const slot = parseInt(k, 10);
          if (slot >= 1 && slot <= 4 && typeof v?.x === "number" && typeof v?.y === "number") {
            this.bookmarks.set(slot, { x: v.x, y: v.y });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private persistBookmarks(): void {
    if (!this.storage) return;
    const obj: Record<number, CameraBookmark> = {};
    for (const [slot, bm] of this.bookmarks) {
      obj[slot] = bm;
    }
    this.storage.setItem(CCTV_STORAGE_KEY, JSON.stringify(obj));
  }
}
