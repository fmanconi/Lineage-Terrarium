import { describe, expect, it } from "vitest";
import {
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  PIP_MIN_WIDTH,
  resizeKeepingRatio,
} from "../src/pip";

const RATIO = 1024 / 600;

describe("resizeKeepingRatio", () => {
  it("grows from the right edge and keeps the scene's shape", () => {
    expect(resizeKeepingRatio(448, 262, 100, 0, EDGE_RIGHT, RATIO)).toEqual({
      width: 548,
      height: Math.round(548 / RATIO),
    });
  });

  it("grows from the left edge when dragged left", () => {
    expect(resizeKeepingRatio(448, 262, -52, 0, EDGE_LEFT, RATIO).width).toBe(500);
  });

  it("takes the width from the height on the top and bottom edges", () => {
    const fromBottom = resizeKeepingRatio(448, 262, 0, 60, EDGE_BOTTOM, RATIO);
    expect(fromBottom.width).toBe(Math.round(322 * RATIO));
    const fromTop = resizeKeepingRatio(448, 262, 0, 60, EDGE_TOP, RATIO);
    expect(fromTop.width).toBe(
      Math.round(202 * RATIO) < PIP_MIN_WIDTH ? PIP_MIN_WIDTH : Math.round(202 * RATIO),
    );
  });

  it("follows whichever edge of a corner asks for more", () => {
    const r = resizeKeepingRatio(448, 262, 10, 100, EDGE_RIGHT | EDGE_BOTTOM, RATIO);
    expect(r.width).toBe(Math.round(362 * RATIO));
  });

  it("stays within the smallest and largest width", () => {
    expect(resizeKeepingRatio(448, 262, -1000, 0, EDGE_RIGHT, RATIO).width).toBe(PIP_MIN_WIDTH);
    expect(resizeKeepingRatio(448, 262, 5000, 0, EDGE_RIGHT, RATIO, 240, 1707).width).toBe(1707);
  });
});
