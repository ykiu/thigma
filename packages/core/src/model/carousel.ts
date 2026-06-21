import type { Model } from "../types.js";
import {
  type TransformPrivateState,
  type TransformAction,
  type BoundsConfig,
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
  /** True when the carousel strip has come to rest at a snap point. */
  isCarouselSettled: boolean;
  /** Horizontal translation of the carousel strip (px). Negative = scrolled right. */
  carouselTranslateX: number;
  /** Per-item transform state keyed by item ID. */
  items: Record<
    string,
    { transformX: number; transformY: number; scale: number }
  >;
};

export type CarouselAction =
  | TransformAction
  | { type: "set-config"; config: CarouselConfig }
  | { type: "navigate-to"; index: number };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type CarouselPrivateState =
  | {
      type: "free";
      itemWidth: number;
      itemHeight: number;
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "carousel";
      itemWidth: number;
      itemHeight: number;
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "items";
      itemWidth: number;
      itemHeight: number;
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
      activeItemId: string;
    };

type MotionEvent = Extract<TransformAction, { type: "motion" }>;

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
  return {
    isCarouselSettled: state.carousel.type === "settled",
    carouselTranslateX: state.carousel.transform.x,
    items,
  };
}

export function createCarouselModel(
  config: CarouselConfig,
): Model<CarouselPublicState, CarouselPrivateState, CarouselAction> {
  const reduce = createCarouselReduce(config);
  return { reduce, publish: toCarouselPublicState };
}

function createCarouselReduce(config: CarouselConfig) {
  const { itemWidth, itemHeight, itemIds } = config;

  // Both reducers are stable constants — no closure state. Bounds live in
  // each item's TransformPrivateState and are updated via "set-bounds".
  const itemReduce = createTransformReduce();
  const carouselReduce = createTransformReduce();

  function makeItemBounds(w: number, h: number): BoundsConfig {
    return {
      elementWidth: w,
      elementHeight: h,
      left: 0,
      right: w,
      top: 0,
      bottom: h,
    };
  }

  function makeInitialItems(): Record<string, TransformPrivateState> {
    const bounds = makeItemBounds(itemWidth, itemHeight);
    const items: Record<string, TransformPrivateState> = {};
    for (const id of itemIds) {
      items[id] = {
        type: "settled",
        bounds,
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
    const { itemWidth: oldItemWidth } = state;
    const {
      itemWidth: newItemWidth,
      itemHeight: newItemHeight,
      itemIds: newItemIds,
    } = newConfig;

    // Find the item the carousel is heading toward in the current (old) layout.
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
        oldItemWidth,
        state.itemIds.length,
      );
    }
    const oldAnchorIndex = Math.max(
      0,
      Math.min(
        state.itemIds.length - 1,
        Math.round(-anchorTargetX / oldItemWidth),
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

    const delta = (oldAnchorIndex - newAnchorIndex) * newItemWidth;
    const minX =
      newItemIds.length > 0 ? -(newItemIds.length - 1) * newItemWidth : 0;
    const newCarousel = shiftCarouselTransform(carousel, delta, minX);

    const dimensionsChanged =
      newItemWidth !== oldItemWidth || newItemHeight !== state.itemHeight;
    const newBounds = dimensionsChanged
      ? makeItemBounds(newItemWidth, newItemHeight)
      : undefined;

    const newItems: Record<string, TransformPrivateState> = {};
    for (const id of newItemIds) {
      const existing = state.items[id];
      if (existing) {
        newItems[id] =
          newBounds !== undefined
            ? itemReduce(existing, { type: "set-bounds", bounds: newBounds })
            : existing;
      } else {
        newItems[id] = {
          type: "settled",
          bounds: newBounds ?? makeItemBounds(newItemWidth, newItemHeight),
          transform: { x: 0, y: 0, scale: 1 },
          lastUpdatedAt: NaN,
        };
      }
    }

    if (state.type === "items" && !newItemIds.includes(state.activeItemId)) {
      return {
        type: "free",
        itemWidth: newItemWidth,
        itemHeight: newItemHeight,
        itemIds: newItemIds,
        carousel: newCarousel,
        items: newItems,
      };
    }

    return {
      ...state,
      itemWidth: newItemWidth,
      itemHeight: newItemHeight,
      itemIds: newItemIds,
      carousel: newCarousel,
      items: newItems,
    };
  }

  return function reduce(
    state: CarouselPrivateState | undefined = {
      type: "free",
      itemWidth,
      itemHeight,
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

    if (action.type === "navigate-to") {
      const clampedIndex = Math.max(
        0,
        Math.min(state.itemIds.length - 1, action.index),
      );
      return {
        type: "free",
        itemWidth: state.itemWidth,
        itemHeight: state.itemHeight,
        itemIds: state.itemIds,
        carousel: {
          type: "settled",
          transform: { x: -clampedIndex * state.itemWidth, y: 0, scale: 1 },
          lastUpdatedAt: Number.NaN,
        },
        items: state.items,
      };
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
                      isHorizontalOverscroll(item, action.dx, state.itemWidth);
                    if (!overscroll) {
                      // Lock to item
                      return {
                        type: "items",
                        itemWidth: state.itemWidth,
                        itemHeight: state.itemHeight,
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
              itemWidth: state.itemWidth,
              itemHeight: state.itemHeight,
              itemIds: state.itemIds,
              carousel,
              items: state.items,
            };
          }
          case "release":
            return state;
          case "slop":
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
          case "set-bounds":
            return state;
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
            // Compute the snap target inline so we can read itemWidth/itemIds from state.
            const { carousel } = state;
            const vx =
              carousel.type === "tracking" || carousel.type === "inertia"
                ? carousel.velocity.vx
                : 0;
            const snapX = computeCarouselSnapTarget(
              carousel.transform.x,
              vx,
              state.itemWidth,
              state.itemIds.length,
            );
            return {
              type: "free",
              itemWidth: state.itemWidth,
              itemHeight: state.itemHeight,
              itemIds: state.itemIds,
              carousel: {
                type: "snapping",
                transform: carousel.transform,
                lastUpdatedAt: carousel.lastUpdatedAt,
                target: { x: snapX, y: 0, scale: 1 },
              },
              items: state.items,
            };
          }
          case "toggle-zoom":
            return state;
          case "slop":
            return state;
          case "tick": {
            const carousel = carouselReduce(state.carousel, action);
            const items = advanceAllItems(state.items, action.timestamp);
            if (carousel === state.carousel && items === state.items)
              return state;
            return { ...state, carousel, items };
          }
          case "set-bounds":
            return state;
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
              itemWidth: state.itemWidth,
              itemHeight: state.itemHeight,
              itemIds: state.itemIds,
              carousel: state.carousel,
              items,
            };
          }
          case "slop":
            return state;
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
          case "set-bounds":
            return state;
        }
        throw new Error("unreachable");
      }
    }
  };
}
