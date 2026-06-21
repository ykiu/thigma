import { describe, it, expect } from "vitest";
import {
  createTransformReduce,
  type TransformPrivateState,
} from "../transform.js";

/** Common transform/timestamp fields shared across all state types. */
function makeTransform(x = 0, y = 0, scale = 1) {
  return {
    transform: { x, y, scale },
    lastUpdatedAt: NaN,
  };
}

/** Common fields for tracking/inertia states that carry velocity. */
function makeTransformWithVelocity(vx = 0, vy = 0, x = 0, y = 0) {
  return {
    transform: { x, y, scale: 1 },
    velocity: { vx, vy, logVScale: 0 },
    lastUpdatedAt: 0,
  };
}

describe("createTransformReduce", () => {
  describe("initial state", () => {
    it("returns settled state with zero transform when called with undefined", () => {
      const reduce = createTransformReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("settled");
      expect(state.transform.x).toBe(0);
      expect(state.transform.y).toBe(0);
      expect(state.transform.scale).toBe(1);
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
          velocity: { vx: 0, vy: 0, logVScale: 0 },
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
          velocity: { vx: 0, vy: 0, logVScale: 0 },
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
      expect(state.transform.x).toBeCloseTo(15);
      expect(state.transform.y).toBeCloseTo(17);
    });

    it("adjusts translation for scale origin", () => {
      const reduce = createTransformReduce();
      // Zoom 2x at (100, 100) from (0, 0)
      // newX = 100 + (0 - 100) * 2 + 0 = -100
      // newY = 100 + (0 - 100) * 2 + 0 = -100
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
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
      expect(state.transform.x).toBeCloseTo(-100);
      expect(state.transform.y).toBeCloseTo(-100);
      expect(state.transform.scale).toBeCloseTo(2);
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
        snapTarget: ({ transform }) => ({
          x: Math.round(transform.x / 100) * 100,
          y: transform.y,
          scale: transform.scale,
        }),
      });
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
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
          velocity: { vx: 0, vy: 0, logVScale: 0 },
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
      expect(after.transform.x).toBeGreaterThan(0);
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
      expect(after.transform.x).toBeGreaterThan(60);
      expect(after.transform.x).toBeLessThan(100);
    });

    it("transitions to settled when within snap threshold", () => {
      const reduce = createTransformReduce();
      const after = reduce(makeSnappingState(99.9, 100), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("settled");
      expect(after.transform.x).toBeCloseTo(100, 0);
    });

    it("converges to snap target over many frames", () => {
      const reduce = createTransformReduce();
      let state: TransformPrivateState = makeSnappingState(0, 100);
      for (let i = 1; i <= 200; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.transform.x).toBeCloseTo(100, 0);
    });
  });

  describe("toggle-zoom", () => {
    function toggleZoom(originX = 0, originY = 0) {
      return {
        type: "toggle-zoom" as const,
        originX,
        originY,
        timestamp: 0,
      };
    }

    it("settled at scale=1 transitions to snapping targeting 2x", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform() },
        toggleZoom(100, 80),
      );
      expect(state.type).toBe("snapping");
      if (state.type === "snapping") {
        expect(state.target.scale).toBe(2);
      }
    });

    it("zoom-in snap target pins the tap point", () => {
      // tap at (100, 80), scale 1→2: targetX = 100*(1-2)+0*2 = -100
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform() },
        toggleZoom(100, 80),
      );
      if (state.type === "snapping") {
        expect(state.target.x).toBeCloseTo(-100);
        expect(state.target.y).toBeCloseTo(-80);
      }
    });

    it("settled at scale=2 transitions to snapping targeting (0,0,1)", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        { type: "settled", ...makeTransform(-50, -50, 2) },
        toggleZoom(100, 80),
      );
      expect(state.type).toBe("snapping");
      if (state.type === "snapping") {
        expect(state.target).toEqual({ x: 0, y: 0, scale: 1 });
      }
    });

    it("inertia transitions to snapping (interrupts inertia)", () => {
      const reduce = createTransformReduce();
      const state = reduce(
        {
          type: "inertia",
          origin: { x: 0, y: 0 },
          ...makeTransformWithVelocity(5, 0),
        },
        toggleZoom(100, 80),
      );
      expect(state.type).toBe("snapping");
    });

    it("tracking is ignored", () => {
      const reduce = createTransformReduce();
      const before: TransformPrivateState = {
        type: "tracking",
        origin: { x: 0, y: 0 },
        velocity: { vx: 0, vy: 0, logVScale: 0 },
        ...makeTransform(),
      };
      expect(reduce(before, toggleZoom())).toBe(before);
    });

    it("snapping is ignored", () => {
      const reduce = createTransformReduce();
      const before: TransformPrivateState = {
        type: "snapping",
        ...makeTransform(60),
        target: { x: 100, y: 0, scale: 1 },
      };
      expect(reduce(before, toggleZoom())).toBe(before);
    });

    it("zoom-in target is clamped to bounds", () => {
      // elementWidth=400, toggleZoomScale=2
      // At scale=2: minX = 400 - 400*2 = -400, maxX = 0
      // tap at originX=500: proposed targetX = 500*(1-2)+0*2 = -500, clamped to -400
      const reduce = createTransformReduce({
        bounds: { elementWidth: 400, elementHeight: 600, left: 0, right: 400, top: 0, bottom: 600 },
      });
      const state = reduce(
        { type: "settled", ...makeTransform() },
        toggleZoom(500, 0),
      );
      if (state.type === "snapping") {
        expect(state.target.x).toBeCloseTo(-400);
      }
    });

    it("respects custom toggleZoomScale", () => {
      const reduce = createTransformReduce({ toggleZoomScale: 3 });
      const state = reduce(
        { type: "settled", ...makeTransform() },
        toggleZoom(100, 0),
      );
      if (state.type === "snapping") {
        expect(state.target.scale).toBe(3);
        // targetX = 100*(1-3)+0*3 = -200
        expect(state.target.x).toBeCloseTo(-200);
      }
    });
  });

  describe("bounds", () => {
    function makeReduceWithBounds() {
      return createTransformReduce({
        bounds: { elementWidth: 400, elementHeight: 600, left: 0, right: 400, top: 0, bottom: 600 },
      });
    }

    it("clamps position to right boundary (maxX = left = 0) during motion", () => {
      // At scale=2: minX = 400-400*2 = -400, maxX = 0. Moving right past 0 is clamped.
      const reduce = makeReduceWithBounds();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
          ...makeTransform(-50, 0, 2),
        },
        {
          type: "motion",
          timestamp: 16,
          dx: 100,
          dy: 0,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.transform.x).toBeCloseTo(0);
    });

    it("clamps position to left boundary (minX = right - w*scale) during motion", () => {
      // At scale=2: minX = 400-400*2 = -400. Moving left past -400 is clamped.
      const reduce = makeReduceWithBounds();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
          ...makeTransform(-390, 0, 2),
        },
        {
          type: "motion",
          timestamp: 16,
          dx: -50,
          dy: 0,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.transform.x).toBeCloseTo(-400);
    });

    it("prevents zooming below minScale (= right/elementWidth = 1) during motion", () => {
      const reduce = makeReduceWithBounds();
      const state = reduce(
        {
          type: "tracking",
          origin: { x: 0, y: 0 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
          ...makeTransform(0, 0, 1),
        },
        {
          type: "motion",
          timestamp: 16,
          dx: 0,
          dy: 0,
          dScale: 0.5,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.transform.scale).toBeCloseTo(1);
    });

    it("clamps scale to minScale in inertia when logVScale is negative", () => {
      const reduce = makeReduceWithBounds();
      const state: TransformPrivateState = {
        type: "inertia",
        origin: { x: 0, y: 0 },
        transform: { x: 0, y: 0, scale: 1 },
        velocity: { vx: 0, vy: 0, logVScale: -0.01 },
        lastUpdatedAt: 0,
      };
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.transform.scale).toBeGreaterThanOrEqual(1);
    });
  });
});
