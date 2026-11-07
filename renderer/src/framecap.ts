/**
 * A cap on the frame rate (R5, ADR 0022): the owner holds the kiosk at 30 fps on the board,
 * which has no fan, so that the GPU draws half of what a 60 Hz screen would ask of it.
 *
 * Chromium has no switch for this: its flags either take the limit off
 * (`--disable-gpu-vsync`, `--disable-frame-rate-limit`) or keep the display's refresh, and
 * none caps a page below it. So the page caps itself: the ticker's own animation-frame
 * loop is stopped and one of ours drives it, letting a frame through only when a whole
 * frame of the cap has gone by since the last one drawn. At 60 Hz every other refresh is
 * drawn; nothing is drawn, moved or uploaded on the ones in between.
 *
 * PixiJS has `Ticker.maxFPS`, but it rounds the time since the last frame down to a whole
 * millisecond before comparing it with the frame's 33.33 ms, so at 60 Hz it lets through
 * every third refresh (20 fps) as often as every other.
 */
import type { Ticker } from "pixi.js";

/**
 * A frame is let through this many milliseconds early: the browser's frame times jitter
 * by a fraction of a millisecond, and a refresh that came a little early must still count.
 */
const EARLY_MS = 2;

/** A live frame-rate cap whose target FPS can be changed at runtime (0 = uncapped). */
export interface FrameCap {
  readonly fps: number;
  set(fps: number): number;
}

/**
 * Drive `ticker` with a mutable frame-rate cap (`set(30)`, `set(60)`, or `set(0)` for
 * uncapped browser refresh). Starts its loop once on first positive cap.
 */
export function createFrameCap(ticker: Ticker, initialFps: number): FrameCap {
  let currentFps = Number.isFinite(initialFps) && initialFps > 0 ? initialFps : 0;
  let started = false;
  let last = -Infinity;

  const ensureLoop = (): void => {
    if (started) return;
    started = true;
    ticker.autoStart = false;
    ticker.stop();
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      if (currentFps > 0) {
        const intervalMs = 1000 / currentFps;
        if (now - last < intervalMs - EARLY_MS) return;
      }
      last = now;
      ticker.update(now);
    };
    requestAnimationFrame(loop);
  };

  if (currentFps > 0) ensureLoop();

  return {
    get fps() {
      return currentFps;
    },
    set(nextFps: number): number {
      currentFps = Number.isFinite(nextFps) && nextFps > 0 ? nextFps : 0;
      if (currentFps > 0) ensureLoop();
      return currentFps;
    },
  };
}

/**
 * Drive `ticker` at no more than `fps` frames a second (0, or anything not a positive
 * number, leaves it alone). Returns the cap in force, 0 for none.
 */
export function capFrames(ticker: Ticker, fps: number): number {
  return createFrameCap(ticker, fps).fps;
}
