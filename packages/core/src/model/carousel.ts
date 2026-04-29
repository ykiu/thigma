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
 *   free   — carousel strip motion is managed by TransformPrivateState.
 *            Transitions to locked when a gesture targets an active or zoomed
 *            item while the strip is settled.
 *   locked — all motion is delegated to the active item. Exits on release.
 */
export type CarouselPrivateState =
  | {
      type: "free";
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "locked";
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

// ---------------------------------------------------------------------------
// Item bounds helper
// ---------------------------------------------------------------------------

/**
 * Returns the pan bounds for an item at the given scale.
 * When scale <= 1 the item fits within its container, so there is no room to pan.
 *
 * Derivation (transform-origin at top-left):
 *   content occupies [transformX, transformX + itemWidth * scale]
 *   to keep content filling the viewport:
 *     transformX <= 0
 *     transformX >= itemWidth * (1 - scale)
 */
function getItemBounds(
  scale: number,
  itemWidth: number,
  itemHeight: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (scale <= 1) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: itemWidth * (1 - scale),
    maxX: 0,
    minY: itemHeight * (1 - scale),
    maxY: 0,
  };
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a motion event should lock the carousel to an item
 * or scroll the carousel strip.
 *
 * Locks when the target item is zoomed, in motion, or the gesture is a pinch.
 */
function resolveMotionTarget(
  action: MotionEvent,
  items: Record<string, TransformPrivateState>,
): { type: "locked"; itemId: string } | { type: "scrolling" } {
  if (action.itemId !== undefined) {
    const item = items[action.itemId];
    if (item) {
      const isZoomed = item.scale.value !== 1;
      const isInMotion = item.type !== "settled";
      if (action.dScale !== 1 || isZoomed || isInMotion) {
        return { type: "locked", itemId: action.itemId };
      }
    }
  }
  return { type: "scrolling" };
}

function findTrackingItemId(
  items: Record<string, TransformPrivateState>,
): string | undefined {
  for (const [id, item] of Object.entries(items)) {
    if (item.type === "tracking") return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Carousel-level helpers
// ---------------------------------------------------------------------------

function computeCarouselSnapTarget(
  x: number,
  itemWidth: number,
  itemCount: number,
): number {
  const nearest = Math.round(x / itemWidth) * itemWidth;
  return Math.max(-(itemCount - 1) * itemWidth, Math.min(0, nearest));
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
    bounds: (scale) => getItemBounds(scale, itemWidth, itemHeight),
    snapTarget: (t) => (t.scale.value < 1 ? { x: 0, y: 0, scale: 1 } : null),
  });

  const carouselReduce = createTransformReduce({
    snapTarget: (t) => ({
      x: computeCarouselSnapTarget(t.x.value, itemWidth, itemIds.length),
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
   * Transitions items into the locked state: starts tracking targetItemId and
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
            if (state.carousel.type === "settled") {
              const target = resolveMotionTarget(action, state.items);
              if (target.type === "locked") {
                return {
                  type: "locked",
                  carousel: state.carousel,
                  items: lockItems(state.items, target.itemId, action),
                };
              }
            }
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
            return { ...state, carousel };
          }
          case "release": {
            const carousel = carouselReduce(state.carousel, action);
            if (carousel === state.carousel) return state;
            return { ...state, carousel };
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

      case "locked": {
        switch (action.type) {
          case "motion": {
            const trackingId = findTrackingItemId(state.items);
            if (trackingId === undefined || action.itemId !== trackingId)
              return state;
            return {
              ...state,
              items: {
                ...state.items,
                [trackingId]: itemReduce(state.items[trackingId], action),
              },
            };
          }
          case "release": {
            const trackingId = findTrackingItemId(state.items);
            const items =
              trackingId !== undefined
                ? {
                    ...state.items,
                    [trackingId]: itemReduce(state.items[trackingId], action),
                  }
                : state.items;
            return { type: "free", carousel: state.carousel, items };
          }
          case "tick": {
            const items = advanceAllItems(state.items, action.timestamp);
            return items === state.items ? state : { ...state, items };
          }
        }
        throw new Error("unreachable");
      }
    }
  };
}
