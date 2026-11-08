/**
 * The first mod (ADR 0024): the bottom-right key bar (`keybar.ts`) and its clickable
 * buttons. Off, the bar is hidden and its clicks fall through to the scene, which is then
 * the bare island again.
 */
import type { KeyBar } from "../../keybar";
import type { Mod, ModMetadata } from "../types";

/** What the key bar takes each frame. */
export type KeyBarOptions = Parameters<KeyBar["update"]>[1];

/** The part of `KeyBar` the mod drives (a stand-in in the tests). */
export type KeyBarLike = Pick<KeyBar, "element" | "wake" | "hitAt" | "update">;

export class DashboardButtonsMod implements Mod {
  readonly meta: ModMetadata = {
    id: "dashboard-buttons",
    name: "Dashboard Buttons",
    version: "1.0.0",
    description: "Interactive bottom-right button bar with mouse clicks and shortcut hints.",
    defaultEnabled: true,
  };
  private enabled = false;

  constructor(private readonly keyBar: KeyBarLike) {}

  init(): void {
    // The bar is already in the frame (`main.ts` appends it with the other overlays).
  }

  enable(): void {
    this.enabled = true;
    this.keyBar.element.style.display = "";
    this.keyBar.wake();
  }

  disable(): void {
    this.enabled = false;
    this.keyBar.element.style.display = "none";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** `options` is the key bar's (`KeyBarOptions`), as `main.ts` builds it each frame. */
  update(dtS: number, options: Record<string, unknown>): void {
    if (this.enabled) this.keyBar.update(dtS, options as unknown as KeyBarOptions);
  }

  /** The button clicked at art pixel (artX, artY), or null; always null while off. */
  hitAt(artX: number, artY: number): string | null {
    return this.enabled ? this.keyBar.hitAt(artX, artY) : null;
  }
}
