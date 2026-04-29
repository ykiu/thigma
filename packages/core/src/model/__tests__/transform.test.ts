import { describe, it, expect } from "vitest";
import {
  createTransformReduce,
  type TransformPrivateState,
} from "../transform.js";
import {
  createLinearPrimitive,
  createExponentialPrimitive,
} from "../primitives.js";

function makeTransform(x = 0, y = 0, scale = 1) {
  return {
    x: createLinearPrimitive(x),
    y: createLinearPrimitive(y),
    scale: createExponentialPrimitive(scale),
  };
}

function makeTransformWithVelocity(vx = 0, vy = 0, x = 0, y = 0) {
  return {
    x: { value: x, velocity: vx, lastUpdatedAt: 0 },
    y: { value: y, velocity: vy, lastUpdatedAt: 0 },
    scale: createExponentialPrimitive(1),
  };
}

describe("createTransformReduce", () => {
  describe("initial state", () => {
    it("returns settled state with zero transform when called with undefined", () => {
      const reduce = createTransformReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("settled");
      expect(state.x.value).toBe(0);
      expect(state.y.value).toBe(0);
      expect(state.scale.value).toBe(1);
    });
  });

  describe("settled state", () => {
    it("transitions to tracking on motion", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform() },
        {
          type: "motion",
          timestamp: 0,
          dx: 10,
          dy: 5,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("stays settled on tick", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform() },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("settled");
    });

    it("stays settled on release", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform() },
        { type: "release" },
      );
      expect(state.type).toBe("settled");
    });
  });

  describe("tracking state", () => {
    it("stays tracking on motion", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransform(),
        },
        {
          type: "motion",
          timestamp: 0,
          dx: 10,
          dy: 5,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("applies translation delta to transform", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransform(10, 20),
        },
        {
          type: "motion",
          timestamp: 0,
          dx: 5,
          dy: -3,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.x.value).toBeCloseTo(15);
      expect(state.y.value).toBeCloseTo(17);
    });

    it("adjusts translation for scale origin", () => {
      const reduce = createTransformReduce();
      // Zoom 2x at (100, 100) from (0, 0)
      // newTx = 100 + (0 - 100) * 2 + 0 = -100
      // newTy = 100 + (0 - 100) * 2 + 0 = -100
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransform(),
        },
        {
          type: "motion",
          timestamp: 0,
          dx: 0,
          dy: 0,
          dScale: 2,
          originX: 100,
          originY: 100,
        },
      );
      expect(state.x.value).toBeCloseTo(-100);
      expect(state.y.value).toBeCloseTo(-100);
      expect(state.scale.value).toBeCloseTo(2);
    });

    it("transitions to inertia on release", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(5, 0),
        },
        { type: "release" },
      );
      expect(state.type).toBe("inertia");
    });

    it("transitions to snapping on release with snap", () => {
      const reduce = createTransformReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransform(60),
        },
        { type: "release" },
      );
      expect(state.type).toBe("snapping");
      if (state.type === "snapping") {
        expect(state.target.x).toBe(100);
      }
    });

    it("stays tracking on tick", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          ...makeTransform(),
        },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("tracking");
    });
  });

  describe("inertia state", () => {
    it("transitions to tracking on motion", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "inertia",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(1, 0),
        },
        {
          type: "motion",
          timestamp: 0,
          dx: 5,
          dy: 0,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("advances inertia on tick when velocity is significant", () => {
      const reduce = createTransformReduce();
      const before = {
        type: "inertia" as const,
        origin: { x: 0, y: 0 },
        ...makeTransformWithVelocity(10, 0),
      };
      const after = reduce(before, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("inertia");
      expect(after.x.value).toBeGreaterThan(0);
    });

    it("transitions to settled on tick when velocity is negligible", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "inertia",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(0, 0),
        },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("settled");
    });

    it("transitions to settled on release", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "inertia",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(),
        },
        { type: "release" },
      );
      expect(state.type).toBe("settled");
    });

    it("transitions to snapping on release with snap", () => {
      const reduce = createTransformReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      const state = reduce(
        {
          type: "inertia",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(0, 0, 60),
        },
        { type: "release" },
      );
      expect(state.type).toBe("snapping");
    });
  });

  describe("snapping state", () => {
    function makeSnappingState(
      x: number,
      targetX: number,
    ): TransformPrivateState {
      return {
        type: "snapping",
        ...makeTransform(x),
        target: { x: targetX, y: 0, scale: 1 },
      };
    }

    it("transitions to tracking on motion", () => {
      const reduce = createTransformReduce();
      const state = reduce(makeSnappingState(60, 100), {
        type: "motion",
        timestamp: 0,
        dx: 5,
        dy: 0,
        dScale: 1,
        originX: 0,
        originY: 0,
      });
      expect(state.type).toBe("tracking");
    });

    it("stays snapping on release", () => {
      const reduce = createTransformReduce();
      const state = reduce(makeSnappingState(60, 100), { type: "release" });
      expect(state.type).toBe("snapping");
    });

    it("advances spring toward target on tick when far", () => {
      const reduce = createTransformReduce();
      const after = reduce(makeSnappingState(60, 100), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("snapping");
      expect(after.x.value).toBeGreaterThan(60);
      expect(after.x.value).toBeLessThan(100);
    });

    it("transitions to settled when within snap threshold", () => {
      const reduce = createTransformReduce();
      const after = reduce(makeSnappingState(99.9, 100), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("settled");
      expect(after.x.value).toBeCloseTo(100, 0);
    });

    it("converges to snap target over many frames", () => {
      const reduce = createTransformReduce();
      let state: TransformPrivateState = makeSnappingState(0, 100);
      for (let i = 1; i <= 200; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.x.value).toBeCloseTo(100, 0);
    });
  });
});
