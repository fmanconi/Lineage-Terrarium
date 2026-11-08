/**
 * Miniature Companion & Picture-in-Picture Engine (ADR 0024):
 *
 * Provides a customizable, floating, and translucent miniature view of Lineage:
 *   1. Opacity / Transparency Regulation:
 *      - Range: 15% (subtle translucent ghost) to 100% (fully solid).
 *      - Desktop Native: controls native OS window opacity via pywebview & WinForms/WebView2.
 *      - Browser / In-App: controls canvas / Document Picture-in-Picture opacity.
 *      - Hotkeys: [ and ] decrease/increase opacity by 10%; 0 resets to 100%.
 *   2. Flexible Dimension Scaling:
 *      - Presets: Micro (280×165), Small (384×225), Medium (512×300), Large (680×400), XL (860×505).
 *      - Hotkeys: - and + scale miniature down and up through presets.
 *   3. Documentary Toast Badge:
 *      - Pixel-art HUD notification toast showing live opacity and dimensions.
 *   4. LocalStorage Persistence:
 *      - Remembers preferred opacity and dimensions across launches.
 */
import { draw, measure } from "./pixelfont";
import type { StorageLike } from "./settings";

export const MINIATURE_STORAGE_KEY = "lineage_miniature_settings_v1";

export interface MiniaturePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const MINIATURE_PRESETS: readonly MiniaturePreset[] = [
  { id: "micro", label: "Micro", width: 280, height: 165 },
  { id: "small", label: "Small", width: 384, height: 225 },
  { id: "medium", label: "Medium", width: 512, height: 300 },
  { id: "large", label: "Large", width: 680, height: 400 },
  { id: "xl", label: "XL", width: 860, height: 505 },
];

export interface MiniatureSettings {
  active: boolean;
  presetIndex: number;
  opacity: number;
}

export const DEFAULT_MINIATURE_SETTINGS: MiniatureSettings = {
  active: false,
  presetIndex: 1, // Small: 384x225
  opacity: 0.85,
};

// Frame colors matching Lineage UI
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const CARD = 0x241432;
const CARD_EDGE = 0x4a2a62;
const TEXT_COLOUR = 0xfaf3e1;
const SHADOW_COLOUR = 0x000000;
const SHADOW_ALPHA = 120;
const TOAST_DURATION_S = 2.8;

export interface DesktopPywebviewApi {
  toggle_miniature?: (
    width: number,
    height: number,
    opacity: number,
  ) => Promise<{ active: boolean; opacity: number; width: number; height: number }>;
  set_opacity?: (alpha: number) => Promise<number>;
  resize_window?: (width: number, height: number) => Promise<{ width: number; height: number }>;
  set_on_top?: (onTop: boolean) => Promise<boolean>;
  toggle_fullscreen?: () => Promise<boolean>;
}

export class MiniatureManager {
  private active = false;
  private presetIndex = 1;
  private opacity = 0.85;
  private toastMessage: string | null = null;
  private toastTimer = 0;
  private storage: StorageLike | null = null;
  private onStateChange: ((active: boolean) => void) | null = null;

  // Browser Document PiP window reference if open
  private pipWindow: Window | null = null;
  // Browser Video PiP element reference if open
  private pipVideo: HTMLVideoElement | null = null;

  constructor(storage: StorageLike | null = null) {
    this.storage = storage;
    this.loadSettings();
  }

  loadSettings(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(MINIATURE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MiniatureSettings>;
        if (typeof parsed.presetIndex === "number" && parsed.presetIndex >= 0 && parsed.presetIndex < MINIATURE_PRESETS.length) {
          this.presetIndex = parsed.presetIndex;
        }
        if (typeof parsed.opacity === "number") {
          this.opacity = Math.max(0.15, Math.min(1.0, parsed.opacity));
        }
      }
    } catch {
      // Ignore corrupt storage
    }
  }

  saveSettings(): void {
    if (!this.storage) return;
    try {
      const state: MiniatureSettings = {
        active: this.active,
        presetIndex: this.presetIndex,
        opacity: this.opacity,
      };
      this.storage.setItem(MINIATURE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable
    }
  }

  isActive(): boolean {
    return this.active;
  }

  getOpacity(): number {
    return this.opacity;
  }

  getPreset(): MiniaturePreset {
    return MINIATURE_PRESETS[this.presetIndex] ?? MINIATURE_PRESETS[1]!;
  }

  getPresetIndex(): number {
    return this.presetIndex;
  }

  currentToast(): string | null {
    return this.toastTimer > 0 ? this.toastMessage : null;
  }

  setOnStateChange(cb: (active: boolean) => void): void {
    this.onStateChange = cb;
  }

  showToast(msg: string): void {
    this.toastMessage = msg;
    this.toastTimer = TOAST_DURATION_S;
  }

  update(dtS: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dtS);
    }
  }

  /** Adjust opacity by delta (e.g. -0.10 or +0.10). Clamped between 0.15 and 1.0. */
  async adjustOpacity(delta: number, canvas?: HTMLCanvasElement): Promise<number> {
    const next = Math.max(0.15, Math.min(1.0, Math.round((this.opacity + delta) * 100) / 100));
    return this.setOpacity(next, canvas);
  }

  /** Set explicit opacity (0.15 .. 1.0). */
  async setOpacity(alpha: number, canvas?: HTMLCanvasElement): Promise<number> {
    this.opacity = Math.max(0.15, Math.min(1.0, alpha));
    this.saveSettings();

    // 1. Desktop native window integration
    const pywebviewApi = (globalThis as unknown as { pywebview?: { api?: DesktopPywebviewApi } })
      .pywebview?.api;
    if (pywebviewApi?.set_opacity) {
      try {
        await pywebviewApi.set_opacity(this.opacity);
      } catch {
        // Desktop API call failed
      }
    }

    // 2. In-browser canvas opacity when active
    if (canvas?.style && (this.active || this.opacity < 1.0)) {
      canvas.style.opacity = this.opacity.toFixed(2);
    }

    // 3. Document PiP window body opacity
    if (this.pipWindow) {
      try {
        const pipDoc = this.pipWindow.document;
        const mainEl = pipDoc.body.firstElementChild as HTMLElement | null;
        if (mainEl) {
          mainEl.style.opacity = this.opacity.toFixed(2);
        }
      } catch {
        // Window closed or inaccessible
      }
    }

    const pct = Math.round(this.opacity * 100);
    const preset = this.getPreset();
    this.showToast(`Trasparenza: ${pct}% | ${preset.label} (${preset.width}x${preset.height})`);
    return this.opacity;
  }

  /** Step size to smaller (-1) or larger (+1) preset. */
  async adjustSize(step: number, canvas?: HTMLCanvasElement): Promise<MiniaturePreset> {
    const nextIdx = Math.max(0, Math.min(MINIATURE_PRESETS.length - 1, this.presetIndex + step));
    return this.setSizeIndex(nextIdx, canvas);
  }

  /** Set preset by index (0..4). */
  async setSizeIndex(index: number, canvas?: HTMLCanvasElement): Promise<MiniaturePreset> {
    this.presetIndex = Math.max(0, Math.min(MINIATURE_PRESETS.length - 1, index));
    const preset = this.getPreset();
    this.saveSettings();

    // 1. Desktop native window resize
    const pywebviewApi = (globalThis as unknown as { pywebview?: { api?: DesktopPywebviewApi } })
      .pywebview?.api;
    if (this.active && pywebviewApi?.resize_window) {
      try {
        await pywebviewApi.resize_window(preset.width, preset.height);
      } catch {
        // Desktop API call failed
      }
    }

    // 2. Document PiP window resize
    if (this.pipWindow) {
      try {
        this.pipWindow.resizeTo(preset.width, preset.height);
      } catch {
        // PiP window resize restricted or closed
      }
    }

    const pct = Math.round(this.opacity * 100);
    this.showToast(`Dimensioni: ${preset.label} (${preset.width}x${preset.height}) | Trasparenza ${pct}%`);
    return preset;
  }

  /** Toggle miniature mode between normal view and floating miniature. */
  async toggle(canvas: HTMLCanvasElement): Promise<boolean> {
    const pywebviewApi = (globalThis as unknown as { pywebview?: { api?: DesktopPywebviewApi } })
      .pywebview?.api;

    // A. Native Desktop Mode (pywebview)
    if (pywebviewApi?.toggle_miniature) {
      const preset = this.getPreset();
      try {
        const res = await pywebviewApi.toggle_miniature(preset.width, preset.height, this.opacity);
        this.active = res.active;
        if (this.active) {
          const pct = Math.round(this.opacity * 100);
          this.showToast(`Miniatura Attiva: ${pct}% | ${preset.label} (${preset.width}x${preset.height})`);
        } else {
          this.showToast("Miniatura: Ripristinata Finestra Completa");
        }
        this.onStateChange?.(this.active);
        this.saveSettings();
        return this.active;
      } catch (err) {
        console.warn("Desktop toggle_miniature failed:", err);
      }
    }

    // B. Browser Document Picture-in-Picture (Chrome / Edge 116+)
    const docPip = (globalThis as unknown as { documentPictureInPicture?: { requestWindow: (opts: { width: number; height: number }) => Promise<Window> } })
      .documentPictureInPicture;

    if (docPip && typeof docPip.requestWindow === "function") {
      if (this.pipWindow && !this.pipWindow.closed) {
        this.pipWindow.close();
        this.pipWindow = null;
        this.active = false;
        if (canvas?.style) canvas.style.opacity = "1";
        this.showToast("Miniatura PiP Chiusa");
        this.onStateChange?.(false);
        this.saveSettings();
        return false;
      }

      try {
        const preset = this.getPreset();
        const pipWin = await docPip.requestWindow({
          width: preset.width,
          height: preset.height,
        });
        this.pipWindow = pipWin;
        this.active = true;

        // Setup PiP container
        pipWin.document.body.style.margin = "0";
        pipWin.document.body.style.backgroundColor = "#10081c";
        pipWin.document.body.style.overflow = "hidden";
        pipWin.document.body.style.display = "flex";
        pipWin.document.body.style.alignItems = "center";
        pipWin.document.body.style.justifyContent = "center";

        // Mirror canvas into PiP window
        const mirrorCanvas = pipWin.document.createElement("canvas");
        mirrorCanvas.width = canvas.width;
        mirrorCanvas.height = canvas.height;
        mirrorCanvas.style.width = "100%";
        mirrorCanvas.style.height = "100%";
        mirrorCanvas.style.objectFit = "contain";
        mirrorCanvas.style.imageRendering = "pixelated";
        mirrorCanvas.style.opacity = this.opacity.toFixed(2);
        pipWin.document.body.appendChild(mirrorCanvas);

        const mirrorCtx = mirrorCanvas.getContext("2d");
        let rafId = 0;
        const renderLoop = (): void => {
          if (pipWin.closed) return;
          if (mirrorCtx) {
            mirrorCtx.drawImage(canvas, 0, 0);
          }
          rafId = pipWin.requestAnimationFrame(renderLoop);
        };
        rafId = pipWin.requestAnimationFrame(renderLoop);

        pipWin.addEventListener("pagehide", () => {
          pipWin.cancelAnimationFrame(rafId);
          this.pipWindow = null;
          this.active = false;
          this.onStateChange?.(false);
          this.saveSettings();
        });

        // Forward hotkeys inside PiP window
        pipWin.addEventListener("keydown", (e: KeyboardEvent) => {
          void this.handleKey(e, canvas);
        });

        const pct = Math.round(this.opacity * 100);
        this.showToast(`PiP Miniatura: ${pct}% | ${preset.label} ([ ] trasp, - + dim)`);
        this.onStateChange?.(true);
        this.saveSettings();
        return true;
      } catch (err) {
        console.warn("Document PiP request failed, falling back:", err);
      }
    }

    // C. Fallback Standard Video Picture-in-Picture
    if (typeof document !== "undefined" && "pictureInPictureEnabled" in document) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        this.active = false;
        this.onStateChange?.(false);
        this.saveSettings();
        return false;
      }
      try {
        if (!this.pipVideo) {
          this.pipVideo = document.createElement("video");
          this.pipVideo.muted = true;
          this.pipVideo.playsInline = true;
          this.pipVideo.autoplay = true;
          const captureCanvas = canvas as HTMLCanvasElement & {
            captureStream?: (fps: number) => MediaStream;
          };
          const stream = captureCanvas.captureStream?.(30);
          if (!stream) throw new Error("No stream available");
          this.pipVideo.srcObject = stream;
          await this.pipVideo.play();
          this.pipVideo.addEventListener("leavepictureinpicture", () => {
            this.active = false;
            this.onStateChange?.(false);
            this.saveSettings();
          });
        }
        await this.pipVideo.requestPictureInPicture();
        this.active = true;
        this.showToast(`Miniatura Standard Attiva (Usa finestra video PiP)`);
        this.onStateChange?.(true);
        this.saveSettings();
        return true;
      } catch (err) {
        console.warn("Standard PiP failed:", err);
      }
    }

    return false;
  }

  /** Handle keyboard shortcuts for miniature regulation. Returns true if handled. */
  async handleKey(e: KeyboardEvent, canvas?: HTMLCanvasElement): Promise<boolean> {
    // [ -> decrease opacity (-10%)
    if (e.key === "[") {
      await this.adjustOpacity(-0.10, canvas);
      return true;
    }
    // ] -> increase opacity (+10%)
    if (e.key === "]") {
      await this.adjustOpacity(+0.10, canvas);
      return true;
    }
    // 0 -> reset opacity to 100%
    if (e.key === "0" && (this.active || this.opacity < 1.0)) {
      await this.setOpacity(1.0, canvas);
      return true;
    }
    // - or _ -> shrink miniature
    if ((e.key === "-" || e.key === "_") && this.active) {
      await this.adjustSize(-1, canvas);
      return true;
    }
    // + or = -> grow miniature
    if ((e.key === "+" || e.key === "=") && this.active) {
      await this.adjustSize(+1, canvas);
      return true;
    }
    // P or p -> toggle miniature
    if (e.key === "p" || e.key === "P") {
      if (canvas) {
        await this.toggle(canvas);
        return true;
      }
    }

    return false;
  }
}

/**
 * Pixel-art HUD toast badge showing current miniature opacity and dimensions.
 */
export class MiniatureBadge {
  readonly element = document.createElement("canvas");
  private paintedText: string | null = null;
  private alpha = 0;

  constructor(
    private readonly manager: MiniatureManager,
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    style.zIndex = "18";
    this.element.dataset.testid = "miniature-badge";
  }

  update(dtS: number): void {
    const text = this.manager.currentToast();
    const shouldShow = text !== null;

    if (shouldShow) {
      this.alpha = Math.min(1, this.alpha + dtS / 0.3);
    } else {
      this.alpha = Math.max(0, this.alpha - dtS / 0.3);
    }

    if (this.alpha <= 0) {
      this.element.style.display = "none";
      return;
    }

    if (text !== null && text !== this.paintedText) {
      this.paint(text);
    }

    this.element.style.opacity = this.alpha.toFixed(2);
    this.element.style.display = "block";
  }

  private paint(text: string): void {
    this.paintedText = text;
    const textW = measure(text);
    const padX = 7;
    const padY = 4;
    const width = textW + padX * 2 + 2;
    const height = 15;

    this.element.width = width;
    this.element.height = height;

    const share = (v: number, total: number): string => `${(100 * v) / total}%`;
    this.element.style.width = share(width, this.screenWidth);
    this.element.style.height = share(height, this.screenHeight);

    // Center horizontally near bottom above keybar
    const left = Math.round((this.screenWidth - width) / 2);
    const top = this.screenHeight - 32;
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

    for (let y = 1; y < height; y++) {
      for (let x = 1; x < width; x++) {
        put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
      }
    }

    for (let y = 0; y < cardH; y++) {
      for (let x = 0; x < cardW; x++) {
        const ring = Math.min(x, y, cardW - 1 - x, cardH - 1 - y);
        if (ring === 0) put(x, y, FRAME_EDGE);
        else if (ring === 1) put(x, y, y === 1 ? FRAME_LIT : CARD_EDGE);
        else put(x, y, CARD);
      }
    }

    draw(text, padX, padY, (px, py) => put(px, py, TEXT_COLOUR));

    const ctx = this.element.getContext("2d");
    if (ctx) {
      ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    }
  }
}
