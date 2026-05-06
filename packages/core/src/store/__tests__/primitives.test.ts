import { describe, it, expect } from "vitest";
import {
  computeDtMs,
  applyScalePivot,
  type Transform,
} from "../../model/primitives.js";

describe("computeDtMs", () => {
  it("returns 16 for NaN lastUpdatedAt (first update)", () => {
    expect(computeDtMs(NaN, 1000)).toBe(16);
  });

  it("returns the elapsed time when less than 100ms", () => {
    expect(computeDtMs(1000, 1016)).toBe(16);
  });

  it("caps at 100ms to avoid huge jumps after suspension", () => {
    expect(computeDtMs(1000, 2000)).toBe(100);
  });
});

describe("applyScalePivot", () => {
  it("keeps origin fixed when scale changes", () => {
    const t: Transform = { x: 0, y: 0, scale: 1 };
    // Zoom 2x at (100, 100): x should become 100 + (0 - 100) * 2 = -100
    const result = applyScalePivot(t, 2, 100, 100);
    expect(result.x).toBeCloseTo(-100);
    expect(result.y).toBeCloseTo(-100);
  });

  it("returns the same position when ds=1 (no scale change)", () => {
    const t: Transform = { x: -50, y: 30, scale: 2 };
    const result = applyScalePivot(t, 1, 100, 100);
    expect(result.x).toBeCloseTo(-50);
    expect(result.y).toBeCloseTo(30);
  });

  it("moves position toward origin when zooming out (ds < 1)", () => {
    const t: Transform = { x: -100, y: -100, scale: 2 };
    // Zoom 0.5x at (0, 0): x = 0 + (-100 - 0) * 0.5 = -50
    const result = applyScalePivot(t, 0.5, 0, 0);
    expect(result.x).toBeCloseTo(-50);
    expect(result.y).toBeCloseTo(-50);
  });
});
