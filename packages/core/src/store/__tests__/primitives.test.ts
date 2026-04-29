import { describe, it, expect } from "vitest";
import {
  advanceLinearSpring,
  createExponentialPrimitive,
  applyExponentialFactor,
  advanceExponentialInertia,
} from "../../model/primitives.js";

describe("advanceLinearSpring", () => {
  it("moves value toward target", () => {
    const prim = { value: 0, velocity: 0, lastUpdatedAt: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeGreaterThan(0);
    expect(next.value).toBeLessThan(100);
  });

  it("converges to target over many frames", () => {
    let prim = { value: 0, velocity: 0, lastUpdatedAt: 0 };
    for (let i = 1; i <= 200; i++) {
      prim = advanceLinearSpring(prim, 100, i * 16);
    }
    expect(prim.value).toBeCloseTo(100, 1);
  });

  it("returns target immediately when already at target", () => {
    const prim = { value: 100, velocity: 0, lastUpdatedAt: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeCloseTo(100);
    expect(next.velocity).toBeCloseTo(0);
  });
});

describe("ExponentialPrimitive", () => {
  it("applies multiplicative factor", () => {
    const prim = createExponentialPrimitive(1);
    // lastUpdatedAt is NaN, so dtMs defaults to 16ms
    const next = applyExponentialFactor(prim, 2, 1000);
    expect(next.value).toBeCloseTo(2);
    expect(next.lastUpdatedAt).toBe(1000);
  });

  it("logVelocity decays to near zero over many frames", () => {
    let prim = applyExponentialFactor(createExponentialPrimitive(1), 1.5, 1000);
    for (let i = 1; i <= 500; i++) {
      prim = advanceExponentialInertia(prim, 1000 + i * 16);
    }
    expect(Math.abs(prim.logVelocity)).toBeLessThan(0.00001);
  });
});
