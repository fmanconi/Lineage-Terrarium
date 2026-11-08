/**
 * The mod registry (ADR 0024): the mods in the order they were registered, which of them
 * are on, and that state kept in local storage (`lineage_mods_state_v1`) as `{ id: on }`.
 * A mod the stored state does not know yet takes its `defaultEnabled`.
 */
import { browserStorage, type StorageLike } from "../settings";
import type { Mod, ModContext } from "./types";

export const MODS_STORAGE_KEY = "lineage_mods_state_v1";

/** A storage that forgets on reload, where the browser's is missing or refused. */
export function memoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function loadState(storage: StorageLike | null): Map<string, boolean> {
  const state = new Map<string, boolean>();
  if (storage === null) return state;
  try {
    const raw = storage.getItem(MODS_STORAGE_KEY);
    if (raw === null) return state;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return state;
    for (const [id, on] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof on === "boolean") state.set(id, on);
    }
  } catch {
    // A corrupt entry: every mod falls back to its default.
  }
  return state;
}

export class ModRegistry {
  private readonly mods: Mod[] = [];
  private readonly state: Map<string, boolean>;
  private ctx: ModContext | null = null;

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    this.state = loadState(storage);
  }

  /** Add a mod; after `initAll`, it is initialised and switched at once. */
  register(mod: Mod): void {
    if (this.getMod(mod.meta.id) !== undefined) {
      throw new Error(`Mod "${mod.meta.id}" is already registered`);
    }
    this.mods.push(mod);
    if (this.ctx !== null) this.start(mod, this.ctx);
  }

  getMods(): readonly Mod[] {
    return this.mods;
  }

  getMod(id: string): Mod | undefined {
    return this.mods.find((mod) => mod.meta.id === id);
  }

  isModEnabled(id: string): boolean {
    const stored = this.state.get(id);
    if (stored !== undefined) return stored;
    return this.getMod(id)?.meta.defaultEnabled ?? false;
  }

  setModEnabled(id: string, enabled: boolean): void {
    const mod = this.getMod(id);
    if (mod === undefined) return;
    const was = this.isModEnabled(id);
    this.state.set(id, enabled);
    this.save();
    if (this.ctx !== null && was !== enabled) {
      if (enabled) mod.enable();
      else mod.disable();
    }
  }

  /** Flip a mod on or off; returns whether it is now on. */
  toggleMod(id: string): boolean {
    if (this.getMod(id) === undefined) return false;
    const next = !this.isModEnabled(id);
    this.setModEnabled(id, next);
    return next;
  }

  /** Initialise every mod registered so far, then switch each to its state. */
  initAll(ctx: ModContext): void {
    this.ctx = ctx;
    for (const mod of this.mods) this.start(mod, ctx);
  }

  dispatchUpdate(dtS: number, options: Record<string, unknown>): void {
    for (const mod of this.enabledMods()) mod.update?.(dtS, options);
  }

  /** Offer a key to the enabled mods in order; `true` once one of them used it. */
  dispatchKey(e: KeyboardEvent): boolean {
    return this.enabledMods().some((mod) => mod.onKey?.(e) === true);
  }

  /** Offer a click to the enabled mods in order; `true` once one of them used it. */
  dispatchPointer(artX: number, artY: number, e: PointerEvent): boolean {
    return this.enabledMods().some((mod) => mod.onPointer?.(artX, artY, e) === true);
  }

  private enabledMods(): Mod[] {
    if (this.ctx === null) return [];
    return this.mods.filter((mod) => this.isModEnabled(mod.meta.id));
  }

  private start(mod: Mod, ctx: ModContext): void {
    mod.init(ctx);
    if (this.isModEnabled(mod.meta.id)) mod.enable();
    else mod.disable();
  }

  private save(): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(MODS_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.state)));
    } catch {
      // Ignore private-mode or read-only kiosk profile errors.
    }
  }
}
