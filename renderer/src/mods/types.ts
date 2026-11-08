/**
 * The mod protocol (ADR 0024): what a renderer mod declares and what the registry drives.
 *
 * Mods live in the renderer only; none reaches `sim/` or `server/`. A mod is created once,
 * registered, initialised with the screen it may draw on, then switched on and off at will
 * from the mod menu (`M`). Its on/off state is the registry's, persisted locally.
 */
import type { StorageLike } from "../settings";

export interface ModMetadata {
  /** Stable key in the persisted state: never rename a released mod's id. */
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  /** Whether the mod is on for someone who has never toggled it. */
  defaultEnabled: boolean;
}

export interface ModContext {
  /** The screen's box, which holds the scene's canvas and the overlays. */
  frame: HTMLElement;
  /** The scene's size in art pixels (512×300). */
  width: number;
  height: number;
  /** Where a mod may keep its own preferences (under its own keys). */
  storage: StorageLike;
}

export interface Mod {
  readonly meta: ModMetadata;
  /** Called once, before the first `enable` or `disable`. */
  init(ctx: ModContext): void;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  /** Each frame while enabled; `options` is the frame's state, as `main.ts` hands it out. */
  update?(dtS: number, options: Record<string, unknown>): void;
  /** A key press while enabled; `true` if the mod used it (nothing else then sees it). */
  onKey?(e: KeyboardEvent): boolean;
  /** A click at art pixel (artX, artY) while enabled; `true` if the mod used it. */
  onPointer?(artX: number, artY: number, e: PointerEvent): boolean;
}
