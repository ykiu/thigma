import type { InterpreterEvent, StoreAction, Model } from "../types.js";
import {
  createLinearPrimitive,
  createExponentialPrimitive,
} from "./primitives.js";
import {
  type TransformPrivateState,
  createTransformReduce,
  settleTransform,
} from "./transform.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CarouselConfig = {
  /** Width of each carousel item in pixels. */
  itemWidth: number;
  /** Height of each carousel item in pixels. */
  itemHeight: number;
  /** Ordered list of item identifiers. */
  itemIds: readonly string[];
};

export type CarouselPublicState = {
  /** Horizontal translation of the carousel strip (px). Negative = scrolled right. */
  carouselTranslateX: number;
  /** Per-item transform state keyed by item ID. */
  items: Record<
    string,
    { transformX: number; transformY: number; scale: number }
  >;
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Carousel-level phase.
 *
 *   free          — no active gesture; animations may still be running.
 *   carousel      — gesture is scrolling the carousel strip.
 *   items         — gesture is targeting activeItemId for pan/zoom.
 *
 * tick advances both carousel and items animations in every phase.
 */
export type CarouselPrivateState =
  | {
      type: "free";
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "carousel";
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "items";
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
      activeItemId: string;
    };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

// ---------------------------------------------------------------------------
// Item bounds helper
// ---------------------------------------------------------------------------

function isHorizontalOverscroll(
  item: TransformPrivateState,
  dx: number,
  itemWidth: number,
): boolean {
  // Item bounds (transform-origin at top-left, item must fill viewport):
  //   maxX = 0 (left edge can't go right of 0)
  //   minX = itemWidth * (1 - scale) (right edge must reach itemWidth)
  return (
    (dx > 0 && item.x.value >= 0) ||
    (dx < 0 && item.x.value <= itemWidth * (1 - item.scale.value))
  );
}

// ---------------------------------------------------------------------------
// Carousel-level helpers
// ---------------------------------------------------------------------------

// Matches the 0.99^ms decay constant used in transform.ts inertia.
const INERTIA_DECAY = -Math.log(0.99);

function computeCarouselSnapTarget(
  x: number,
  velocity: number,
  itemWidth: number,
  itemCount: number,
): number {
  const projected = x + velocity / INERTIA_DECAY;
  const nearest = Math.round(projected / itemWidth) * itemWidth;
  return Math.max(-(itemCount - 1) * itemWidth, Math.min(0, nearest)) || 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toCarouselPublicState(
  state: CarouselPrivateState,
): CarouselPublicState {
  const items: Record<
    string,
    { transformX: number; transformY: number; scale: number }
  > = {};
  for (const [id, item] of Object.entries(state.items)) {
    items[id] = {
      transformX: item.x.value,
      transformY: item.y.value,
      scale: item.scale.value,
    };
  }
  return { carouselTranslateX: state.carousel.x.value, items };
}

export function createCarouselModel(
  config: CarouselConfig,
): Model<CarouselPublicState, CarouselPrivateState, StoreAction> {
  const reduce = createCarouselReduce(config);
  return { reduce, publish: toCarouselPublicState };
}

function createCarouselReduce(config: CarouselConfig) {
  const { itemWidth, itemHeight, itemIds } = config;

  const itemReduce = createTransformReduce({
    elementWidth: itemWidth,
    elementHeight: itemHeight,
    bounds: { left: 0, right: itemWidth, top: 0, bottom: itemHeight },
  });

  const carouselReduce = createTransformReduce({
    snapTarget: (t) => ({
      x: computeCarouselSnapTarget(
        t.x.value,
        t.x.velocity,
        itemWidth,
        itemIds.length,
      ),
      y: 0,
      scale: 1,
    }),
  });

  function makeInitialItems(): Record<string, TransformPrivateState> {
    const items: Record<string, TransformPrivateState> = {};
    for (const id of itemIds) {
      items[id] = {
        type: "settled",
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      };
    }
    return items;
  }

  /**
   * Transitions items into the tracking state: starts tracking targetItemId and
   * immediately settles any other items that are in motion (one active item at a time).
   */
  function lockItems(
    items: Record<string, TransformPrivateState>,
    targetItemId: string,
    action: MotionEvent,
  ): Record<string, TransformPrivateState> {
    const result: Record<string, TransformPrivateState> = {};
    for (const [id, item] of Object.entries(items)) {
      if (id === targetItemId) {
        result[id] = itemReduce(item, action);
      } else if (item.type !== "settled") {
        result[id] = settleTransform(item);
      } else {
        result[id] = item;
      }
    }
    return result;
  }

  function advanceAllItems(
    items: Record<string, TransformPrivateState>,
    timestamp: number,
  ): Record<string, TransformPrivateState> {
    let changed = false;
    const result: Record<string, TransformPrivateState> = {};
    for (const [id, item] of Object.entries(items)) {
      const next = itemReduce(item, { type: "tick", timestamp });
      result[id] = next;
      if (next !== item) changed = true;
    }
    return changed ? result : items;
  }

  return function reduce(
    state: CarouselPrivateState | undefined = {
      type: "free",
      carousel: {
        type: "settled",
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
      items: makeInitialItems(),
    },
    action: StoreAction,
  ): CarouselPrivateState {
    switch (state.type) {
      case "free": {
        switch (action.type) {
          case "motion": {
            // Determine whether a motion event should lock the carousel to an item
            // or scroll the carousel strip.
            if (state.carousel.type === "settled") {
              if (action.itemId !== undefined) {
                const item = state.items[action.itemId];
                if (item) {
                  const isZoomed = item.scale.value !== 1;
                  const isInMotion = item.type !== "settled";
                  if (action.dScale !== 1 || isZoomed || isInMotion) {
                    const overscroll =
                      isZoomed &&
                      !isInMotion &&
                      action.dScale === 1 &&
                      isHorizontalOverscroll(item, action.dx, itemWidth);
                    if (!overscroll) {
                      // Lock to item
                      return {
                        type: "items",
                        carousel: state.carousel,
                        items: lockItems(state.items, action.itemId, action),
                        activeItemId: action.itemId,
                      };
                    }
                  }
                }
              }
            }
            const normalizedAction = {
              ...action,
              dy: 0,
              dScale: 1,
              originX: 0,
              originY: 0,
            };
            const carousel = carouselReduce(state.carousel, normalizedAction);
            return { type: "carousel", carousel, items: state.items };
          }
          case "release":
            return state;
          case "toggle-zoom": {
            if (action.itemId === undefined) return state;
            const item = state.items[action.itemId];
            if (!item) return state;
            return {
              ...state,
              items: {
                ...state.items,
                [action.itemId]: itemReduce(item, action),
              },
            };
          }
          case "tick": {
            const carousel = carouselReduce(state.carousel, action);
            const items = advanceAllItems(state.items, action.timestamp);
            if (carousel === state.carousel && items === state.items)
              return state;
            return { ...state, carousel, items };
          }
        }
        throw new Error("unreachable");
      }

      case "carousel": {
        switch (action.type) {
          case "motion": {
            // Item-targeted gestures cannot interrupt a snap.
            if (
              state.carousel.type === "snapping" &&
              action.itemId !== undefined
            ) {
              return state;
            }
            const normalizedAction = {
              ...action,
              dy: 0,
              dScale: 1,
              originX: 0,
              originY: 0,
            };
            const carousel = carouselReduce(state.carousel, normalizedAction);
            if (carousel === state.carousel) return state;
            return { ...state, carousel };
          }
          case "release": {
            const carousel = carouselReduce(state.carousel, action);
            return { type: "free", carousel, items: state.items };
          }
          case "toggle-zoom":
            return state;
          case "tick": {
            const carousel = carouselReduce(state.carousel, action);
            const items = advanceAllItems(state.items, action.timestamp);
            if (carousel === state.carousel && items === state.items)
              return state;
            return { ...state, carousel, items };
          }
        }
        throw new Error("unreachable");
      }

      case "items": {
        switch (action.type) {
          case "motion": {
            if (action.itemId !== state.activeItemId) return state;
            return {
              ...state,
              items: {
                ...state.items,
                [state.activeItemId]: itemReduce(
                  state.items[state.activeItemId],
                  action,
                ),
              },
            };
          }
          case "release": {
            const items = {
              ...state.items,
              [state.activeItemId]: itemReduce(
                state.items[state.activeItemId],
                action,
              ),
            };
            return { type: "free", carousel: state.carousel, items };
          }
          case "toggle-zoom": {
            if (action.itemId !== state.activeItemId) return state;
            return {
              ...state,
              items: {
                ...state.items,
                [state.activeItemId]: itemReduce(
                  state.items[state.activeItemId],
                  action,
                ),
              },
            };
          }
          case "tick": {
            const carousel = carouselReduce(state.carousel, action);
            const items = advanceAllItems(state.items, action.timestamp);
            if (carousel === state.carousel && items === state.items)
              return state;
            return { ...state, carousel, items };
          }
        }
        throw new Error("unreachable");
      }
    }
  };
}
