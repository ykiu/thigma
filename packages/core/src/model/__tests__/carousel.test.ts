import { describe, it, expect } from "vitest";
import {
  createCarouselModel,
  type CarouselPrivateState,
  type CarouselAction,
} from "../carousel.js";
import type { BoundsConfig, TransformPrivateState } from "../transform.js";

const ITEM_WIDTH = 400;
const ITEM_HEIGHT = 600;
const ITEM_IDS = ["a", "b", "c"] as const;

const ITEM_BOUNDS: BoundsConfig = {
  elementWidth: ITEM_WIDTH,
  elementHeight: ITEM_HEIGHT,
  left: 0,
  right: ITEM_WIDTH,
  top: 0,
  bottom: ITEM_HEIGHT,
};

const DEFAULT_CONFIG = {
  itemWidth: ITEM_WIDTH,
  itemHeight: ITEM_HEIGHT,
  itemIds: ITEM_IDS,
} as const;

function makeReduce() {
  return createCarouselModel(DEFAULT_CONFIG).reduce;
}

/** Common transform/timestamp fields without velocity (settled/snapping). */
function makeItemCore(x = 0, y = 0, scale = 1, lastUpdatedAt = 0) {
  return { transform: { x, y, scale }, lastUpdatedAt };
}

/** Fields for tracking/inertia states that carry velocity. */
function makeItemWithVelocity(x = 0, y = 0, scale = 1, vx = 0, logVScale = 0) {
  return {
    transform: { x, y, scale },
    velocity: { vx, vy: 0, logVScale },
    lastUpdatedAt: 0,
  };
}

function makeSettledItem(x = 0, y = 0, scale = 1): TransformPrivateState {
  return {
    type: "settled",
    bounds: ITEM_BOUNDS,
    ...makeItemCore(x, y, scale, NaN),
  };
}

function makeInertiaItem(
  x = 0,
  y = 0,
  scale = 1,
  vx = 0,
): TransformPrivateState {
  return {
    type: "inertia",
    bounds: ITEM_BOUNDS,
    origin: { x: 0, y: 0 },
    ...makeItemWithVelocity(x, y, scale, vx),
  };
}

function makeTrackingItem(x = 0, y = 0, scale = 1): TransformPrivateState {
  return {
    type: "tracking",
    bounds: ITEM_BOUNDS,
    origin: { x: 0, y: 0 },
    ...makeItemWithVelocity(x, y, scale),
  };
}

function makeSettledCarousel(x = 0): TransformPrivateState {
  return {
    type: "settled",
    transform: { x, y: 0, scale: 1 },
    lastUpdatedAt: NaN,
  };
}

/** Returns a free state with the carousel strip settled. */
function free(
  carouselX = 0,
  itemOverrides: Partial<
    Record<string, { x?: number; y?: number; scale?: number }>
  > = {},
): CarouselPrivateState {
  const items: Record<string, TransformPrivateState> = {};
  for (const id of ITEM_IDS) {
    const { x = 0, y = 0, scale = 1 } = itemOverrides[id] ?? {};
    items[id] = makeSettledItem(x, y, scale);
  }
  return {
    type: "free",
    itemWidth: ITEM_WIDTH,
    itemHeight: ITEM_HEIGHT,
    itemIds: ITEM_IDS,
    carousel: makeSettledCarousel(carouselX),
    items,
  };
}

/** Returns a carousel state with a tracking carousel strip. */
function makeCarouselTrackingState(carouselX = 0): CarouselPrivateState {
  return {
    type: "carousel",
    itemWidth: ITEM_WIDTH,
    itemHeight: ITEM_HEIGHT,
    itemIds: ITEM_IDS,
    carousel: {
      type: "tracking",
      origin: { x: carouselX, y: 0 },
      transform: { x: carouselX, y: 0, scale: 1 },
      velocity: { vx: 0, vy: 0, logVScale: 0 },
      lastUpdatedAt: 0,
    },
    items: {
      a: makeSettledItem(),
      b: makeSettledItem(),
      c: makeSettledItem(),
    },
  };
}

/** Returns an items state with item "a" tracking. */
function makeItemsState(
  aConfig: { x: number; y: number; scale: number } = {
    x: -50,
    y: -50,
    scale: 2,
  },
): CarouselPrivateState {
  return {
    type: "items",
    itemWidth: ITEM_WIDTH,
    itemHeight: ITEM_HEIGHT,
    itemIds: ITEM_IDS,
    carousel: makeSettledCarousel(),
    items: {
      a: makeTrackingItem(aConfig.x, aConfig.y, aConfig.scale),
      b: makeSettledItem(),
      c: makeSettledItem(),
    },
    activeItemId: "a",
  };
}

function motion(
  opts: Partial<{
    itemId: string;
    dx: number;
    dy: number;
    dScale: number;
    originX: number;
    originY: number;
    timestamp: number;
  }> = {},
) {
  return {
    type: "motion" as const,
    dx: 0,
    dy: 0,
    dScale: 1,
    originX: 0,
    originY: 0,
    timestamp: 0,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createCarouselModel", () => {
  describe("initial state", () => {
    it("starts in free/settled with carousel at 0 and all items settled at neutral", () => {
      const reduce = makeReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("free");
      expect(state.carousel.type).toBe("settled");
      expect(state.carousel.transform.x).toBe(0);
      for (const id of ITEM_IDS) {
        expect(state.items[id].type).toBe("settled");
        expect(state.items[id].transform.x).toBe(0);
        expect(state.items[id].transform.y).toBe(0);
        expect(state.items[id].transform.scale).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // free state
  // -------------------------------------------------------------------------

  describe("free state", () => {
    it("returns the same reference on tick when no items are in motion", () => {
      const reduce = makeReduce();
      const state = free();
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next).toBe(state);
    });

    it("returns the same reference on release", () => {
      const reduce = makeReduce();
      const state = free();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("advances inertia items on tick (parallel operation)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("free");
      expect(next.items.a.type).toBe("inertia");
      expect(next.items.a.transform.x).toBeLessThan(-50);
    });

    it("transitions to carousel on carousel pan (no itemId)", () => {
      const reduce = makeReduce();
      const state = reduce(free(), motion({ dx: -50 }));
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
      expect(state.carousel.transform.x).toBeCloseTo(-50);
    });

    it("transitions to carousel when item at scale=1 is panned (carousel moves, item stays)", () => {
      const reduce = makeReduce();
      const state = reduce(free(), motion({ itemId: "a", dx: -80 }));
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
      expect(state.carousel.transform.x).toBeCloseTo(-80);
      expect(state.items.a.transform.x).toBe(0);
    });

    it("transitions to carousel when zoomed item overscrolls right (at right edge, dx > 0)", () => {
      const reduce = makeReduce();
      // item a: zoomed to scale=2, x=0 (right edge, maxX=0)
      const state = reduce(
        free(0, { a: { x: 0, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: 50 }),
      );
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
      expect(state.carousel.transform.x).toBeCloseTo(50);
    });

    it("transitions to carousel when zoomed item overscrolls left (at left edge, dx < 0)", () => {
      const reduce = makeReduce();
      // item a: zoomed to scale=2, x=minX=-400 (left edge)
      const state = reduce(
        free(0, { a: { x: -ITEM_WIDTH, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: -50 }),
      );
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
      expect(state.carousel.transform.x).toBeCloseTo(-50);
    });

    it("does not transition to carousel when zoomed item is panned within bounds", () => {
      const reduce = makeReduce();
      // item a: zoomed to scale=2, x=-200 (middle, minX=-400, maxX=0)
      const state = reduce(
        free(0, { a: { x: -200, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: -50 }),
      );
      expect(state.type).toBe("items");
    });

    it("transitions to items when a zoomed-in item is panned", () => {
      const reduce = makeReduce();
      let state = reduce(
        free(0, { a: { x: -50, y: -50, scale: 2 } }),
        motion({ itemId: "a" }),
      );
      state = reduce(state, motion({ itemId: "a", dx: 0, dy: 0 }));
      expect(state.type).toBe("items");
      if (state.type === "items") {
        expect(state.activeItemId).toBe("a");
        expect(state.items.a.type).toBe("tracking");
        expect(state.items.a.transform.x).toBeCloseTo(-50);
        expect(state.items.a.transform.y).toBeCloseTo(-50);
        expect(state.items.b.transform.x).toBe(0);
      }
    });

    it("transitions to items on pinch (dScale != 1), even when item is at scale=1", () => {
      const reduce = makeReduce();
      const state = reduce(free(), motion({ itemId: "a", dScale: 1.5 }));
      expect(state.type).toBe("items");
      if (state.type === "items") {
        expect(state.activeItemId).toBe("a");
        expect(state.items.a.type).toBe("tracking");
      }
    });

    it("treats unknown itemId as carousel motion", () => {
      const reduce = makeReduce();
      let state = reduce(free(), motion({ itemId: "unknown", dx: -30 }));
      state = reduce(state, motion({ itemId: "unknown", dx: -30 }));
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
    });

    it("transitions to items on an item in inertia", () => {
      const reduce = makeReduce();
      const freeWithInertia: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      let state = reduce(freeWithInertia, motion({ itemId: "a" }));
      state = reduce(state, motion({ itemId: "a", dx: 10 }));
      expect(state.type).toBe("items");
      if (state.type === "items") {
        expect(state.activeItemId).toBe("a");
        expect(state.items.a.type).toBe("tracking");
      }
    });

    it("cancels inertia item when locking on a different item", () => {
      const reduce = makeReduce();
      const freeWithInertia: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(0, 0, 2),
          c: makeSettledItem(),
        },
      };
      let state = reduce(freeWithInertia, motion({ itemId: "b" }));
      state = reduce(state, motion({ itemId: "b", dx: 5 }));
      expect(state.type).toBe("items");
      if (state.type === "items") {
        expect(state.items.a.type).toBe("settled"); // cancelled
        expect(state.items.b.type).toBe("tracking");
      }
    });
  });

  // -------------------------------------------------------------------------
  // carousel state
  // -------------------------------------------------------------------------

  describe("carousel state", () => {
    it("returns the same reference on tick when no items are in motion", () => {
      const reduce = makeReduce();
      const state = makeCarouselTrackingState();
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next).toBe(state);
    });

    it("transitions to free with snapping carousel on release", () => {
      const reduce = makeReduce();
      let state = reduce(free(), motion({ dx: -50 }));
      state = reduce(state, motion({ dx: -50 }));
      state = reduce(state, { type: "release" });
      expect(state.type).toBe("free");
      expect(state.carousel.type).toBe("snapping");
    });

    it("snap target is the nearest item boundary", () => {
      const reduce = makeReduce();
      let state = reduce(free(), motion());
      state = reduce(state, motion()); // → carousel, tracking origin established
      state = reduce(state, motion({ dx: -210 })); // → x = -210
      state = reduce(state, { type: "release" });
      expect(state.type).toBe("free");
      expect(state.carousel.type).toBe("snapping");
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBe(-ITEM_WIDTH);
      }
    });

    it("snap target stays at 0 when swiped less than halfway to next item", () => {
      const reduce = makeReduce();
      let state = reduce(free(), motion());
      state = reduce(state, motion({ dx: -190 })); // → x = -190, still snaps to 0 (< halfway to next item)
      state = reduce(state, { type: "release" });
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBeCloseTo(0);
      }
    });

    it("snap target is the next item when flicked even if less than halfway across", () => {
      const reduce = makeReduce();
      // x=-100, velocity=-2 px/ms → projected ≈ -100 - 199 = -299 → snaps to -400
      const flickState: CarouselPrivateState = {
        type: "carousel",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "tracking",
          origin: { x: 0, y: 0 },
          transform: { x: -100, y: 0, scale: 1 },
          velocity: { vx: -2, vy: 0, logVScale: 0 },
          lastUpdatedAt: 0,
        },
        items: {
          a: makeSettledItem(),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(flickState, { type: "release" });
      expect(state.type).toBe("free");
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBe(-ITEM_WIDTH);
      }
    });

    it("snap target returns to previous item when flicked back even if past halfway", () => {
      const reduce = makeReduce();
      // x=-300, velocity=+2 px/ms → projected ≈ -300 + 199 = -101 → snaps to 0
      const flickBackState: CarouselPrivateState = {
        type: "carousel",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "tracking",
          origin: { x: 0, y: 0 },
          transform: { x: -300, y: 0, scale: 1 },
          velocity: { vx: 2, vy: 0, logVScale: 0 },
          lastUpdatedAt: 0,
        },
        items: {
          a: makeSettledItem(),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(flickBackState, { type: "release" });
      expect(state.type).toBe("free");
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBe(0);
      }
    });

    it("snap target is clamped to the last item boundary", () => {
      const reduce = makeReduce();
      let state = reduce(free(-800), motion());
      state = reduce(state, motion({ dx: -1000 })); // first tracking motion: origin at -800, dx ignored
      state = reduce(state, { type: "release" });
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBe(
          -(ITEM_IDS.length - 1) * ITEM_WIDTH,
        );
      }
    });

    it("does not transition to items on pinch while carousel is tracking", () => {
      const reduce = makeReduce();
      let state = reduce(free(), motion({ dx: -50 }));
      state = reduce(state, motion({ dx: -50 })); // → carousel, tracking
      state = reduce(state, motion({ itemId: "a", dScale: 1.5 }));
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
    });

    it("advances inertia items on tick while scrolling (parallel operation)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "carousel",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "tracking",
          origin: { x: 0, y: 0 },
          transform: { x: -50, y: 0, scale: 1 },
          velocity: { vx: 0, vy: 0, logVScale: 0 },
          lastUpdatedAt: 0,
        },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("carousel");
      expect(next.carousel.type).toBe("tracking");
      expect(next.items.a.type).toBe("inertia");
      expect(next.items.a.transform.x).toBeLessThan(-50);
    });

    it("can start scrolling the carousel while item is still in inertia", () => {
      const reduce = makeReduce();
      const freeWithInertia: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(freeWithInertia, motion({ dx: -30 })); // → carousel, tracking
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
      expect(state.items.a.type).toBe("inertia"); // item continues
    });
  });

  // -------------------------------------------------------------------------
  // items state
  // -------------------------------------------------------------------------

  describe("items state", () => {
    it("returns the same reference on tick when no items are animating", () => {
      const reduce = makeReduce();
      const state = makeItemsState();
      expect(reduce(state, { type: "tick", timestamp: 16 })).toBe(state);
    });

    it("applies motion to the tracking item", () => {
      const reduce = makeReduce();
      const state = reduce(
        makeItemsState(),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("items");
      expect(state.items.a.type).toBe("tracking");
      expect(state.items.a.transform.x).toBeCloseTo(-40);
      expect(state.items.a.transform.y).toBeCloseTo(-45);
    });

    it("does not move non-tracking items", () => {
      const reduce = makeReduce();
      const state = reduce(makeItemsState(), motion({ itemId: "a", dx: 10 }));
      expect(state.items.b.transform.x).toBe(0);
      expect(state.items.c.transform.x).toBe(0);
    });

    it("ignores motion targeting a different item (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeItemsState();
      const after = reduce(before, motion({ itemId: "b", dx: 30 }));
      expect(after).toBe(before);
    });

    it("ignores motion with no itemId (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeItemsState();
      const after = reduce(before, motion({ dx: 30 }));
      expect(after).toBe(before);
    });

    it("does not move the carousel during item pan", () => {
      const reduce = makeReduce();
      const state = reduce(makeItemsState(), motion({ itemId: "a", dx: 30 }));
      expect(state.carousel.transform.x).toBe(0);
    });

    it("discards overflow when item is panned beyond its right bound", () => {
      const reduce = makeReduce();
      const before = makeItemsState({ x: 0, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: 50 }));
      expect(after.items.a.transform.x).toBeCloseTo(0);
      expect(after.carousel.transform.x).toBeCloseTo(0);
    });

    it("discards overflow when item is panned beyond its left bound", () => {
      const reduce = makeReduce();
      const before = makeItemsState({ x: -400, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: -50 }));
      expect(after.items.a.transform.x).toBeCloseTo(-400);
      expect(after.carousel.transform.x).toBeCloseTo(0);
    });

    it("transitions to free on release, item transitions to inertia", () => {
      const reduce = makeReduce();
      const state = reduce(makeItemsState(), { type: "release" });
      expect(state.type).toBe("free");
      expect(state.carousel.type).toBe("settled");
      expect(state.items.a.type).toBe("inertia");
    });

    it("item transitions to inertia on release when it has significant velocity", () => {
      const reduce = makeReduce();
      const itemsWithVelocity: CarouselPrivateState = {
        type: "items",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: {
            type: "tracking",
            bounds: ITEM_BOUNDS,
            origin: { x: 0, y: 0 },
            ...makeItemWithVelocity(-50, 0, 2, -5),
          },
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
        activeItemId: "a",
      };
      const state = reduce(itemsWithVelocity, { type: "release" });
      expect(state.type).toBe("free");
      expect(state.items.a.type).toBe("inertia");
    });

    it("bounds prevent item from zooming below scale=1", () => {
      const reduce = makeReduce();
      const state = reduce(
        makeItemsState({ x: 0, y: 0, scale: 1 }),
        motion({ itemId: "a", dScale: 0.5, originX: 0, originY: 0 }),
      );
      expect(state.items.a.transform.scale).toBeCloseTo(1);
    });

    it("advances carousel animations on tick", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "items",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "snapping",
          transform: { x: -200, y: 0, scale: 1 },
          lastUpdatedAt: 0,
          target: { x: -400, y: 0, scale: 1 },
        },
        items: {
          a: makeTrackingItem(-50, 0, 2),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
        activeItemId: "a",
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("items");
      expect(next.carousel.type).toBe("snapping");
      expect(next.carousel.transform.x).toBeLessThan(-200);
    });
  });

  // -------------------------------------------------------------------------
  // Item-level inertia (carousel settled, item animating)
  // -------------------------------------------------------------------------

  describe("item inertia (parallel with carousel settled)", () => {
    function makeSettledCarouselWithInertiaItem(): CarouselPrivateState {
      return {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances item inertia on tick", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("free");
      expect(after.items.a.type).toBe("inertia");
      expect(after.items.a.transform.x).toBeLessThan(-50);
    });

    it("does not move the carousel during item inertia", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.carousel.transform.x).toBe(0);
    });

    it("does not move non-inertia items", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.items.b.transform.x).toBe(0);
    });

    it("item settles when velocity decays", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, 0, 2), // no velocity → settles immediately
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.items.a.type).toBe("settled");
      expect(next.items.a.transform.x).toBeCloseTo(-50);
    });

    it("item stays at its current position after settling (no snap to neutral)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeInertiaItem(-50, -30, 2),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.items.a.transform.x).toBeCloseTo(-50);
      expect(next.items.a.transform.y).toBeCloseTo(-30);
      expect(next.items.a.transform.scale).toBeCloseTo(2);
    });
  });

  // -------------------------------------------------------------------------
  // Item-level snapping (under-zoom recovery)
  // -------------------------------------------------------------------------

  describe("item snapping (under-zoom recovery)", () => {
    function makeSnappingItemState(): CarouselPrivateState {
      return {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: {
            type: "snapping",
            transform: { x: 0, y: 0, scale: 0.5 },
            lastUpdatedAt: 0,
            target: { x: 0, y: 0, scale: 1 },
          },
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances item spring toward scale=1 on tick", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingItemState(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.items.a.type).toBe("snapping");
      expect(after.items.a.transform.scale).toBeGreaterThan(0.5);
      expect(after.items.a.transform.scale).toBeLessThan(1);
    });

    it("settles item when scale reaches target", () => {
      const reduce = makeReduce();
      let state = makeSnappingItemState();
      for (let i = 1; i <= 500; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.items.a.type === "settled") break;
      }
      expect(state.items.a.type).toBe("settled");
      expect(state.items.a.transform.scale).toBeCloseTo(1, 2);
    });
  });

  // -------------------------------------------------------------------------
  // free state, carousel snapping
  // -------------------------------------------------------------------------

  describe("free state, carousel snapping", () => {
    function makeSnappingState(
      carouselX = -200,
      carouselTarget = -400,
    ): CarouselPrivateState {
      return {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "snapping",
          transform: { x: carouselX, y: 0, scale: 1 },
          lastUpdatedAt: 0,
          target: { x: carouselTarget, y: 0, scale: 1 },
        },
        items: {
          a: makeSettledItem(-50, 0, 1.5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances carousel spring on tick when far from target", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(-200, -400), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("free");
      expect(after.carousel.type).toBe("snapping");
      expect(after.carousel.transform.x).toBeLessThan(-200);
      expect(after.carousel.transform.x).toBeGreaterThan(-400);
    });

    it("items do not spring during carousel snapping (stay at current position)", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.items.a.transform.scale).toBe(1.5);
      expect(after.items.a.transform.x).toBe(-50);
    });

    it("transitions to free/settled when carousel is within snap threshold", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("free");
      expect(after.carousel.type).toBe("settled");
      expect(after.carousel.transform.x).toBeCloseTo(-400);
    });

    it("items stay at their current positions on settling", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("free");
      expect(after.carousel.type).toBe("settled");
      expect(after.items.a.transform.scale).toBe(1.5);
      expect(after.items.a.transform.x).toBe(-50);
    });

    it("converges carousel to snap target over many frames", () => {
      const reduce = makeReduce();
      let state: CarouselPrivateState = makeSnappingState(-200, -400);
      for (let i = 1; i <= 300; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.carousel.type === "settled") break;
      }
      expect(state.type).toBe("free");
      expect(state.carousel.type).toBe("settled");
      expect(state.carousel.transform.x).toBeCloseTo(-400, 0);
    });

    it("stays snapping on release (returns same reference)", () => {
      const reduce = makeReduce();
      const state = makeSnappingState();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("transitions to carousel tracking on motion without itemId (interrupts snap)", () => {
      const reduce = makeReduce();
      let state: CarouselPrivateState = makeSnappingState();
      state = reduce(state, motion({ dx: -20 })); // → carousel
      expect(state.type).toBe("carousel");
      expect(state.carousel.type).toBe("tracking");
    });
  });

  // -------------------------------------------------------------------------
  // toggle-zoom
  // -------------------------------------------------------------------------

  describe("toggle-zoom", () => {
    function toggleZoom(
      opts: Partial<{ itemId: string; originX: number; originY: number }> = {},
    ) {
      return {
        type: "toggle-zoom" as const,
        originX: 0,
        originY: 0,
        timestamp: 0,
        ...opts,
      };
    }

    it("free state: routes to the targeted item", () => {
      const reduce = makeReduce();
      const state = reduce(free(), toggleZoom({ itemId: "a" }));
      expect(state.type).toBe("free");
      expect(state.items.a.type).toBe("snapping");
      expect(state.items.b.type).toBe("settled");
    });

    it("free state: zooms in to 2x centered at origin", () => {
      const reduce = makeReduce();
      const state = reduce(
        free(),
        toggleZoom({ itemId: "a", originX: 100, originY: 80 }),
      );
      expect(state.items.a.type).toBe("snapping");
      if (state.items.a.type === "snapping") {
        expect(state.items.a.target.scale).toBe(2);
        expect(state.items.a.target.x).toBeCloseTo(-100);
        expect(state.items.a.target.y).toBeCloseTo(-80);
      }
    });

    it("free state: zooms out when item is already zoomed in", () => {
      const reduce = makeReduce();
      const state = reduce(
        free(0, { a: { x: -50, y: -50, scale: 2 } }),
        toggleZoom({ itemId: "a" }),
      );
      expect(state.items.a.type).toBe("snapping");
      if (state.items.a.type === "snapping") {
        expect(state.items.a.target).toEqual({ x: 0, y: 0, scale: 1 });
      }
    });

    it("free state: ignored when itemId is absent (same reference)", () => {
      const reduce = makeReduce();
      const before = free();
      expect(reduce(before, toggleZoom())).toBe(before);
    });

    it("free state: ignored for unknown itemId (same reference)", () => {
      const reduce = makeReduce();
      const before = free();
      expect(reduce(before, toggleZoom({ itemId: "unknown" }))).toBe(before);
    });

    it("carousel state: ignored (same reference)", () => {
      const reduce = makeReduce();
      const before = makeCarouselTrackingState();
      expect(reduce(before, toggleZoom({ itemId: "a" }))).toBe(before);
    });

    it("items state: routes to the active item", () => {
      const reduce = makeReduce();
      // item "a" is settled and zoomed in; toggle-zoom should snap it back out
      const itemsWithSettledItem: CarouselPrivateState = {
        type: "items",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeSettledItem(-50, -50, 2),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
        activeItemId: "a",
      };
      const state = reduce(itemsWithSettledItem, toggleZoom({ itemId: "a" }));
      expect(state.type).toBe("items");
      expect(state.items.a.type).toBe("snapping");
    });

    it("items state: ignored for a non-active item (same reference)", () => {
      const reduce = makeReduce();
      // item "a" is settled and zoomed in
      const before: CarouselPrivateState = {
        type: "items",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: makeSettledCarousel(),
        items: {
          a: makeSettledItem(-50, -50, 2),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
        activeItemId: "a",
      };
      expect(reduce(before, toggleZoom({ itemId: "b" }))).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // set-config
  // -------------------------------------------------------------------------

  describe("set-config", () => {
    function setConfig(newItemIds: readonly string[]): CarouselAction {
      return {
        type: "set-config",
        config: {
          itemWidth: ITEM_WIDTH,
          itemHeight: ITEM_HEIGHT,
          itemIds: newItemIds,
        },
      };
    }

    it("adds new items with neutral transform", () => {
      const reduce = makeReduce();
      const state = reduce(free(), setConfig(["a", "b", "c", "d"]));
      expect(state.items.d).toBeDefined();
      expect(state.items.d.transform).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("removes deleted items", () => {
      const reduce = makeReduce();
      const state = reduce(free(), setConfig(["a", "b"]));
      expect(state.items.c).toBeUndefined();
      expect(Object.keys(state.items)).toHaveLength(2);
    });

    it("preserves transform state of surviving items", () => {
      const reduce = makeReduce();
      const state = reduce(
        free(0, { a: { x: -50, y: -30, scale: 2 } }),
        setConfig(["a", "b"]),
      );
      expect(state.items.a.transform).toEqual({ x: -50, y: -30, scale: 2 });
    });

    it("keeps carousel anchored on current item when an earlier item is deleted", () => {
      // Settled on item "b" (index 1 → x=-400). After deleting "a", "b" is at index 0.
      // Carousel should shift to x=0 so "b" stays on screen.
      const reduce = makeReduce();
      const state = reduce(free(-ITEM_WIDTH), setConfig(["b", "c"]));
      expect(state.carousel.transform.x).toBeCloseTo(0);
    });

    it("keeps carousel anchored when an earlier item is inserted", () => {
      // Settled on item "a" (index 0 → x=0). After inserting "z" before "a", "a" is at index 1.
      // Carousel should shift to x=-400 so "a" stays on screen.
      const reduce = makeReduce();
      const state = reduce(free(0), setConfig(["z", "a", "b", "c"]));
      expect(state.carousel.transform.x).toBeCloseTo(-ITEM_WIDTH);
    });

    it("snapping state: shifts both transform.x and target.x", () => {
      const reduce = makeReduce();
      // Carousel snapping toward item "b" (index 1, x=-400). Delete "a" → "b" moves to index 0.
      const snapping: CarouselPrivateState = {
        type: "free",
        itemWidth: ITEM_WIDTH,
        itemHeight: ITEM_HEIGHT,
        itemIds: ITEM_IDS,
        carousel: {
          type: "snapping",
          transform: { x: -200, y: 0, scale: 1 },
          lastUpdatedAt: 0,
          target: { x: -ITEM_WIDTH, y: 0, scale: 1 },
        },
        items: {
          a: makeSettledItem(),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(snapping, setConfig(["b", "c"]));
      expect(state.carousel.type).toBe("snapping");
      if (state.carousel.type === "snapping") {
        expect(state.carousel.target.x).toBeCloseTo(0);
        expect(state.carousel.transform.x).toBeCloseTo(200);
      }
    });

    it("drops to free when active item is deleted", () => {
      const reduce = makeReduce();
      const state = reduce(makeItemsState(), setConfig(["b", "c"]));
      expect(state.type).toBe("free");
    });

    it("stays in items state when active item survives", () => {
      const reduce = makeReduce();
      const state = reduce(makeItemsState(), setConfig(["a", "c"]));
      expect(state.type).toBe("items");
      if (state.type === "items") {
        expect(state.activeItemId).toBe("a");
      }
    });

    it("updates itemIds in state", () => {
      const reduce = makeReduce();
      const state = reduce(free(), setConfig(["b", "c"]));
      expect(state.itemIds).toEqual(["b", "c"]);
    });

    it("clamps carousel to new bounds when items shrink", () => {
      // Settled on last item "c" (index 2, x=-800). After reducing to ["a","b"], max index=1.
      const reduce = makeReduce();
      const state = reduce(free(-2 * ITEM_WIDTH), setConfig(["a", "b"]));
      expect(state.carousel.transform.x).toBeCloseTo(-ITEM_WIDTH);
    });

    it("updates itemWidth and itemHeight in state", () => {
      const reduce = makeReduce();
      const state = reduce(free(), {
        type: "set-config",
        config: { itemWidth: 300, itemHeight: 500, itemIds: ITEM_IDS },
      });
      expect(state.itemWidth).toBe(300);
      expect(state.itemHeight).toBe(500);
    });

    it("navigate-to uses updated itemWidth after dimensions change", () => {
      const reduce = makeReduce();
      const newWidth = 300;
      let state = reduce(free(), {
        type: "set-config",
        config: {
          itemWidth: newWidth,
          itemHeight: ITEM_HEIGHT,
          itemIds: ITEM_IDS,
        },
      });
      state = reduce(state, { type: "navigate-to", index: 1 });
      expect(state.carousel.transform.x).toBe(-newWidth);
    });
  });

  // -------------------------------------------------------------------------
  // publish
  // -------------------------------------------------------------------------

  describe("publish", () => {
    it("maps private state to public state correctly", () => {
      const { publish } = createCarouselModel(DEFAULT_CONFIG);
      const state = free(-400, { a: { x: -10, y: 5, scale: 1.5 } });
      const pub = publish(state);
      expect(pub.carouselTranslateX).toBe(-400);
      expect(pub.items.a).toEqual({
        transformX: -10,
        transformY: 5,
        scale: 1.5,
      });
      expect(pub.items.b).toEqual({
        transformX: 0,
        transformY: 0,
        scale: 1,
      });
    });
  });
});
