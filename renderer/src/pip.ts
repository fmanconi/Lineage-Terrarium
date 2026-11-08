/**
 * The floating miniature (the desktop app's picture-in-picture).
 *
 * On the desktop the PiP key opens a second window: frameless, always on top, holding
 * the scene and nothing else, like a browser's video pop-out. The game window hides
 * until the miniature goes back. This module is the miniature's own chrome, laid over
 * the scene with `?pip`: buttons that show while the pointer is over the window and fade
 * when it rests or leaves, a drag surface over the whole window (pywebview's drag
 * region), and grips on the edges and corners that resize it keeping the scene's shape.
 *
 * The chrome is plain DOM and vector glyphs, not pixel art, on purpose: it is the
 * window's furniture, not part of the island, and it must read at any size.
 */

/** Which edges a grip moves, as bit flags. */
export const EDGE_LEFT = 1;
export const EDGE_RIGHT = 2;
export const EDGE_TOP = 4;
export const EDGE_BOTTOM = 8;

/** The smallest miniature, in CSS pixels of width. */
export const PIP_MIN_WIDTH = 240;

/** Seconds the controls stay up after the pointer last moved. */
const IDLE_HIDE_MS = 1800;

/** Width of the edge grips and size of the corner grips, in CSS pixels. */
const EDGE_GRIP = 6;
const CORNER_GRIP = 14;

/**
 * The window's new size when a grip on `edges` has been dragged by (dx, dy) from a
 * window of `startW` by `startH`: the scene's ratio is kept, a corner follows whichever
 * of its two edges asks for more, and the width stays within [minW, maxW].
 */
export function resizeKeepingRatio(
  startW: number,
  startH: number,
  dx: number,
  dy: number,
  edges: number,
  ratio: number,
  minW = PIP_MIN_WIDTH,
  maxW = Number.POSITIVE_INFINITY,
): { width: number; height: number } {
  const fromX = edges & EDGE_LEFT ? startW - dx : edges & EDGE_RIGHT ? startW + dx : Number.NaN;
  const fromY =
    edges & EDGE_TOP
      ? (startH - dy) * ratio
      : edges & EDGE_BOTTOM
        ? (startH + dy) * ratio
        : Number.NaN;
  let width: number;
  if (Number.isNaN(fromX) && Number.isNaN(fromY)) width = startW;
  else if (Number.isNaN(fromX)) width = fromY;
  else if (Number.isNaN(fromY)) width = fromX;
  else width = Math.max(fromX, fromY);
  width = Math.round(Math.min(maxW, Math.max(minW, width)));
  return { width, height: Math.round(width / ratio) };
}

/** What the chrome asks of the window around it. */
export interface PipHost {
  /** Back to the game window (the miniature closes). */
  back(): void;
  /** Close the miniature, leaving the game window minimised. */
  close(): void;
  /** Mute or unmute the soundscape; returns whether it is now muted. */
  toggleAudio(): boolean;
  /** Whether the soundscape is muted now. */
  muted(): boolean;
  /** Step the camera to the next view. */
  nextView(): void;
  /** Resize the window, keeping still the corner opposite `edges`. */
  resize(width: number, height: number, edges: number): Promise<unknown> | undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The glyphs, as 24×24 stroked paths. */
const GLYPHS = {
  back: "M14 4h6v6 M20 4l-8 8 M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  close: "M6 6l12 12 M18 6L6 18",
  sound: "M4 9v6h4l5 4V5L8 9H4z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12",
  muted: "M4 9v6h4l5 4V5L8 9H4z M17 9l5 6 M22 9l-5 6",
  view: "M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
} as const;

function glyph(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

const STYLE = `
.lpip { position: fixed; inset: 0; z-index: 1000; user-select: none; }
.lpip-drag { position: absolute; inset: 0; cursor: default; }
.lpip-shade { position: absolute; left: 0; right: 0; height: 56px; pointer-events: none;
  opacity: 0; transition: opacity 180ms ease; }
.lpip-shade.top { top: 0; background: linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,0)); }
.lpip-shade.bottom { bottom: 0; background: linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.55)); }
.lpip-btn { position: absolute; width: 32px; height: 32px; border: 0; border-radius: 16px;
  padding: 0; display: flex; align-items: center; justify-content: center; color: #fff;
  background: transparent; cursor: pointer; opacity: 0; pointer-events: none;
  transition: opacity 180ms ease, background-color 120ms ease;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
.lpip-btn:hover { background: rgba(255,255,255,.2); }
.lpip-btn:active { background: rgba(255,255,255,.32); }
.lpip-btn[data-tip]:hover::after { content: attr(data-tip); position: absolute; top: 36px;
  white-space: nowrap; font: 12px/1.2 system-ui, sans-serif; padding: 4px 7px;
  border-radius: 4px; background: rgba(20,20,24,.92); color: #fff; pointer-events: none; }
.lpip-btn.bottom[data-tip]:hover::after { top: auto; bottom: 36px; }
.lpip-btn.left[data-tip]:hover::after { left: 0; }
.lpip-btn.right[data-tip]:hover::after { right: 0; }
.lpip.awake .lpip-shade { opacity: 1; }
.lpip.awake .lpip-btn { opacity: 1; pointer-events: auto; }
.lpip-grip { position: absolute; z-index: 2; }
`;

/** The miniature's chrome: build once with `?pip`, it lives as long as the page. */
export class PipChrome {
  readonly element: HTMLDivElement;
  private readonly host: PipHost;
  private readonly ratio: number;
  private readonly audioButton: HTMLButtonElement;
  private hideTimer: number | null = null;
  private overButton = false;
  private resizing = false;

  constructor(host: PipHost, ratio: number) {
    this.host = host;
    this.ratio = ratio;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.className = "lpip";
    root.dataset.testid = "pip-chrome";
    this.element = root;

    // The whole window drags (pywebview moves a frameless window from its drag region);
    // a double click goes back to the game window.
    const drag = document.createElement("div");
    drag.className = "lpip-drag pywebview-drag-region";
    drag.addEventListener("dblclick", () => host.back());
    root.appendChild(drag);

    const top = document.createElement("div");
    top.className = "lpip-shade top";
    const bottom = document.createElement("div");
    bottom.className = "lpip-shade bottom";
    root.append(top, bottom);

    root.append(
      this.button("back", "Torna alla finestra", { top: 8, left: 8 }, () => host.back()),
      this.button("close", "Chiudi", { top: 8, right: 8 }, () => host.close()),
      this.button("view", "Cambia vista", { bottom: 8, right: 8 }, () => host.nextView()),
    );
    this.audioButton = this.button("sound", "Audio", { bottom: 8, left: 8 }, () => {
      host.toggleAudio();
      this.refreshAudio();
    });
    root.appendChild(this.audioButton);
    this.refreshAudio();

    for (const edges of [
      EDGE_LEFT,
      EDGE_RIGHT,
      EDGE_TOP,
      EDGE_BOTTOM,
      EDGE_LEFT | EDGE_TOP,
      EDGE_RIGHT | EDGE_TOP,
      EDGE_LEFT | EDGE_BOTTOM,
      EDGE_RIGHT | EDGE_BOTTOM,
    ]) {
      root.appendChild(this.grip(edges));
    }

    window.addEventListener("pointermove", () => this.wake());
    window.addEventListener("pointerdown", () => this.wake());
    document.documentElement.addEventListener("mouseleave", () => {
      if (!this.resizing) this.sleep();
    });
    window.addEventListener("blur", () => {
      if (!this.resizing) this.sleep();
    });
  }

  /** Show the controls, and hide them again once the pointer rests. */
  wake(): void {
    this.element.classList.add("awake");
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (!this.overButton && !this.resizing) this.sleep();
    }, IDLE_HIDE_MS);
  }

  sleep(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.element.classList.remove("awake");
  }

  /** Redraw the audio button for the soundscape's state now. */
  refreshAudio(): void {
    const muted = this.host.muted();
    this.audioButton.replaceChildren(glyph(muted ? GLYPHS.muted : GLYPHS.sound));
    this.audioButton.dataset.tip = muted ? "Riattiva audio" : "Disattiva audio";
  }

  private button(
    name: keyof typeof GLYPHS,
    tip: string,
    at: { top?: number; bottom?: number; left?: number; right?: number },
    action: () => void,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = [
      "lpip-btn",
      at.bottom !== undefined ? "bottom" : "top",
      at.left !== undefined ? "left" : "right",
    ].join(" ");
    b.dataset.tip = tip;
    b.dataset.testid = `pip-${name}`;
    b.setAttribute("aria-label", tip);
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const v = at[side];
      if (v !== undefined) b.style[side] = `${v}px`;
    }
    b.appendChild(glyph(GLYPHS[name]));
    b.addEventListener("pointerenter", () => {
      this.overButton = true;
    });
    b.addEventListener("pointerleave", () => {
      this.overButton = false;
    });
    // The scene underneath must not take the click as a press, nor the window a drag.
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    return b;
  }

  private grip(edges: number): HTMLDivElement {
    const g = document.createElement("div");
    g.className = "lpip-grip";
    const corner =
      (edges & (EDGE_LEFT | EDGE_RIGHT)) !== 0 && (edges & (EDGE_TOP | EDGE_BOTTOM)) !== 0;
    const s = g.style;
    if (corner) {
      s.width = s.height = `${CORNER_GRIP}px`;
      s[edges & EDGE_LEFT ? "left" : "right"] = "0";
      s[edges & EDGE_TOP ? "top" : "bottom"] = "0";
      s.cursor =
        ((edges & EDGE_LEFT) !== 0) === ((edges & EDGE_TOP) !== 0) ? "nwse-resize" : "nesw-resize";
    } else if (edges & (EDGE_LEFT | EDGE_RIGHT)) {
      s.top = s.bottom = `${CORNER_GRIP}px`;
      s.width = `${EDGE_GRIP}px`;
      s[edges & EDGE_LEFT ? "left" : "right"] = "0";
      s.cursor = "ew-resize";
    } else {
      s.left = s.right = `${CORNER_GRIP}px`;
      s.height = `${EDGE_GRIP}px`;
      s[edges & EDGE_TOP ? "top" : "bottom"] = "0";
      s.cursor = "ns-resize";
    }

    let start = { x: 0, y: 0, w: 0, h: 0 };
    let wanted: { width: number; height: number } | null = null;
    let inFlight = false;
    // One resize at a time goes to the window; the latest wanted size waits behind it.
    const pump = (): void => {
      if (inFlight || wanted === null) return;
      const { width, height } = wanted;
      wanted = null;
      inFlight = true;
      void Promise.resolve(this.host.resize(width, height, edges))
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          pump();
        });
    };
    g.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      this.resizing = true;
      start = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
    });
    g.addEventListener("mousedown", (e) => e.stopPropagation());
    g.addEventListener("pointermove", (e) => {
      if (!this.resizing || !g.hasPointerCapture(e.pointerId)) return;
      wanted = resizeKeepingRatio(
        start.w,
        start.h,
        e.screenX - start.x,
        e.screenY - start.y,
        edges,
        this.ratio,
        PIP_MIN_WIDTH,
        window.screen.availWidth,
      );
      pump();
    });
    const end = (e: PointerEvent): void => {
      if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
      this.resizing = false;
      this.wake();
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    return g;
  }
}
