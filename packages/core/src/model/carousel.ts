import type { InterpreterEvent, StoreAction, Model } from "../types.js";
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

export type CarouselAction =
  | StoreAction
  | { type: "set-config"; config: CarouselConfig };

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
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "carousel";
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "items";
      itemIds: readonly string[];
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
    (dx > 0 && item.transform.x >= 0) ||
    (dx < 0 && item.transform.x <= itemWidth * (1 - item.transform.scale))
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
      transformX: item.transform.x,
      transformY: item.transform.y,
      scale: item.transform.scale,
    };
  }
  return { carouselTranslateX: state.carousel.transform.x, items };
}

export function createCarouselModel(
  config: CarouselConfig,
): Model<CarouselPublicState, CarouselPrivateState, CarouselAction> {
  const reduce = createCarouselReduce(config);
  return { reduce, publish: toCarouselPublicState };
}

function createCarouselReduce(config: CarouselConfig) {
  const { itemWidth, itemHeight, itemIds } = config;

  // Mutable item count so the snap-target closure always uses the latest value.
  let itemCount = itemIds.length;

  const itemReduce = createTransformReduce({
    elementWidth: itemWidth,
    elementHeight: itemHeight,
    bounds: { left: 0, right: itemWidth, top: 0, bottom: itemHeight },
  });

  const carouselReduce = createTransformReduce({
    snapTarget: ({ transform, velocity }) => ({
      x: computeCarouselSnapTarget(
        transform.x,
        velocity.vx,
        itemWidth,
        itemCount,
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
        transform: { x: 0, y: 0, scale: 1 },
        lastUpdatedAt: NaN,
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

  // ---------------------------------------------------------------------------
  // set-config helpers
  // ---------------------------------------------------------------------------

  function shiftCarouselTransform(
    carousel: TransformPrivateState,
    delta: number,
    minX: number,
  ): TransformPrivateState {
    if (delta === 0) return carousel;
    switch (carousel.type) {
      case "snapping": {
        // Don't clamp the current transform — it's mid-animation and will
        // converge naturally to the (clamped) target.
        const newTargetX = Math.max(
          minX,
          Math.min(0, carousel.target.x + delta),
        );
        return {
          ...carousel,
          transform: {
            ...carousel.transform,
            x: carousel.transform.x + delta,
          },
          target: { ...carousel.target, x: newTargetX },
        };
      }
      default: {
        const newX = Math.max(minX, Math.min(0, carousel.transform.x + delta));
        return { ...carousel, transform: { ...carousel.transform, x: newX } };
      }
    }
  }

  function applySetConfig(
    state: CarouselPrivateState,
    newConfig: CarouselConfig,
  ): CarouselPrivateState {
    const newItemIds = newConfig.itemIds;

    // Find the item the carousel is heading toward in the current list.
    const carousel = state.carousel;
    let anchorTargetX: number;
    if (carousel.type === "snapping") {
      anchorTargetX = carousel.target.x;
    } else {
      const vx =
        carousel.type === "tracking" || carousel.type === "inertia"
          ? carousel.velocity.vx
          : 0;
      anchorTargetX = computeCarouselSnapTarget(
        carousel.transform.x,
        vx,
        itemWidth,
        state.itemIds.length,
      );
    }
    const oldAnchorIndex = Math.max(
      0,
      Math.min(
        state.itemIds.length - 1,
        Math.round(-anchorTargetX / itemWidth),
      ),
    );
    const anchorId = state.itemIds[oldAnchorIndex];

    // Find anchor in new list; fall back to nearest valid index if deleted.
    let newAnchorIndex = newItemIds.indexOf(anchorId);
    if (newAnchorIndex < 0) {
      newAnchorIndex = Math.max(
        0,
        Math.min(newItemIds.length - 1, oldAnchorIndex),
      );
    }

    const delta = (oldAnchorIndex - newAnchorIndex) * itemWidth;
    const minX =
      newItemIds.length > 0 ? -(newItemIds.length - 1) * itemWidth : 0;
    const newCarousel = shiftCarouselTransform(carousel, delta, minX);

    const newItems: Record<string, TransformPrivateState> = {};
    for (const id of newItemIds) {
      newItems[id] = state.items[id] ?? {
        type: "settled",
        transform: { x: 0, y: 0, scale: 1 },
        lastUpdatedAt: NaN,
      };
    }

    // Update the mutable count so the snap-target closure stays current.
    itemCount = newItemIds.length;

    if (state.type === "items" && !newItemIds.includes(state.activeItemId)) {
      return {
        type: "free",
        itemIds: newItemIds,
        carousel: newCarousel,
        items: newItems,
      };
    }

    return {
      ...state,
      itemIds: newItemIds,
      carousel: newCarousel,
      items: newItems,
    };
  }

  return function reduce(
    state: CarouselPrivateState | undefined = {
      type: "free",
      itemIds,
      carousel: {
        type: "settled",
        transform: { x: 0, y: 0, scale: 1 },
        lastUpdatedAt: NaN,
      },
      items: makeInitialItems(),
    },
    action: CarouselAction,
  ): CarouselPrivateState {
    if (action.type === "set-config") {
      return applySetConfig(state, action.config);
    }

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
                  const isZoomed = item.transform.scale !== 1;
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
                        itemIds: state.itemIds,
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
            return {
              type: "carousel",
              itemIds: state.itemIds,
              carousel,
              items: state.items,
            };
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
            return {
              type: "free",
              itemIds: state.itemIds,
              carousel,
              items: state.items,
            };
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
            return {
              type: "free",
              itemIds: state.itemIds,
              carousel: state.carousel,
              items,
            };
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
