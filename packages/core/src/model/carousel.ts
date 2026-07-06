import type { Model } from "../types.js";
import {
  type TransformPrivateState,
  type TransformAction,
  type BoundsConfig,
  createTransformReduce,
  settleTransform,
} from "./transform.js";
import { computeDtMs } from "./primitives.js";

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
  /** When true, a vertical slop gesture on a scale=1 settled item enters dismissing state. */
  dismissible?: boolean;
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
} & (
  | { isDismissed: false; dismissProgress: number }
  | { isDismissed: true; dismissProgress: 1 }
);

export type CarouselAction =
  | Exclude<TransformAction, { type: "set-bounds" }>
  | { type: "set-config"; config: CarouselConfig }
  | { type: "navigate-to"; index: number }
  | { type: "navigate-by"; delta: number };

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
    }
  | {
      // Position tracked in flat fields rather than TransformPrivateState because
      // dismiss motion has no bounds, no pinch scale, and scale is derived from y
      // rather than tracked — reusing TransformPrivateState would conflict with its
      // scale-tracking logic.
      type: "dismissing";
      itemWidth: number;
      itemHeight: number;
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
      activeItemId: string;
      dismissX: number;
      dismissY: number;
      dismissVx: number;
      dismissVy: number;
      dismissPivotX: number;
      dismissPivotY: number;
      lastUpdatedAt: number;
    }
  | {
      type: "dismissed";
      itemWidth: number;
      itemHeight: number;
      itemIds: readonly string[];
      carousel: TransformPrivateState;
      items: Record<string, TransformPrivateState>;
      activeItemId: string;
      dismissX: number;
      dismissY: number;
      dismissPivotX: number;
      dismissPivotY: number;
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

const INERTIA_DECAY = -Math.log(0.999 /* larger value: more inertia */);

function computeCarouselSnapTarget(
  x: number,
  velocity: number,
  itemWidth: number,
  itemCount: number,
): number {
  // Contain the projected position to the nearest item boundary
  const projected =
    x +
    Math.min(Math.max(velocity / INERTIA_DECAY, -itemWidth / 2), itemWidth / 2);
  const nearest = Math.round(projected / itemWidth) * itemWidth;
  return Math.max(-(itemCount - 1) * itemWidth, Math.min(0, nearest)) || 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function deriveDismissScale(y: number, itemHeight: number): number {
  return Math.max(0, 1 - Math.abs(y) / (2 * itemHeight));
}

function toCarouselPublicState(
  state: CarouselPrivateState,
): CarouselPublicState {
  if (state.type === "dismissed") {
    const {
      activeItemId,
      dismissX,
      dismissY,
      dismissPivotX,
      dismissPivotY,
      itemHeight,
    } = state;
    const items: Record<
      string,
      { transformX: number; transformY: number; scale: number }
    > = {};
    for (const [id, item] of Object.entries(state.items)) {
      if (id === activeItemId) {
        const scale = deriveDismissScale(dismissY, itemHeight);
        items[id] = {
          transformX: dismissX + dismissPivotX * (1 - scale),
          transformY: dismissY + dismissPivotY * (1 - scale),
          scale,
        };
      } else {
        items[id] = {
          transformX: item.transform.x,
          transformY: item.transform.y,
          scale: item.transform.scale,
        };
      }
    }
    return {
      isCarouselSettled: state.carousel.type === "settled",
      carouselTranslateX: state.carousel.transform.x,
      items,
      isDismissed: true,
      dismissProgress: 1,
    };
  }

  if (state.type === "dismissing") {
    const {
      activeItemId,
      dismissX,
      dismissY,
      dismissPivotX,
      dismissPivotY,
      itemHeight,
    } = state;
    const items: Record<
      string,
      { transformX: number; transformY: number; scale: number }
    > = {};
    for (const [id, item] of Object.entries(state.items)) {
      if (id === activeItemId) {
        const scale = deriveDismissScale(dismissY, itemHeight);
        items[id] = {
          transformX: dismissX + dismissPivotX * (1 - scale),
          transformY: dismissY + dismissPivotY * (1 - scale),
          scale,
        };
      } else {
        items[id] = {
          transformX: item.transform.x,
          transformY: item.transform.y,
          scale: item.transform.scale,
        };
      }
    }
    return {
      isCarouselSettled: state.carousel.type === "settled",
      carouselTranslateX: state.carousel.transform.x,
      items,
      isDismissed: false,
      dismissProgress: Math.min(1, Math.abs(dismissY) / (2 * itemHeight)),
    };
  }

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
    isDismissed: false,
    dismissProgress: 0,
  };
}

export function createCarouselModel(
  config: CarouselConfig,
): Model<CarouselPublicState, CarouselPrivateState, CarouselAction> {
  const reduce = createCarouselReduce(config);
  return { reduce, publish: toCarouselPublicState };
}

function createCarouselReduce(config: CarouselConfig) {
  const { itemWidth, itemHeight, itemIds, dismissible = false } = config;

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

    if (
      (state.type === "items" || state.type === "dismissing") &&
      !newItemIds.includes(state.activeItemId)
    ) {
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

    if (action.type === "navigate-by") {
      // Only meaningful while the strip is at rest or snapping; ignored mid-gesture.
      if (state.type !== "free" || state.itemIds.length === 0) return state;
      const { carousel } = state;
      // While snapping, step relative to the destination so repeated presses accumulate.
      const baseX =
        carousel.type === "snapping" ? carousel.target.x : carousel.transform.x;
      const baseIndex = Math.round(-baseX / state.itemWidth);
      const clampedIndex = Math.max(
        0,
        Math.min(state.itemIds.length - 1, baseIndex + action.delta),
      );
      const targetX = -clampedIndex * state.itemWidth;
      if (
        carousel.type === "snapping"
          ? carousel.target.x === targetX
          : carousel.transform.x === targetX
      )
        return state;
      return {
        ...state,
        carousel: {
          type: "snapping",
          transform: carousel.transform,
          lastUpdatedAt: carousel.lastUpdatedAt,
          target: { x: targetX, y: 0, scale: 1 },
        },
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
          case "slop": {
            if (
              dismissible &&
              state.carousel.type === "settled" &&
              action.itemId !== undefined &&
              Math.abs(action.dy) > Math.abs(action.dx)
            ) {
              const item = state.items[action.itemId];
              if (item?.transform.scale === 1 && item.type === "settled") {
                return {
                  type: "dismissing",
                  itemWidth: state.itemWidth,
                  itemHeight: state.itemHeight,
                  itemIds: state.itemIds,
                  carousel: state.carousel,
                  items: state.items,
                  activeItemId: action.itemId,
                  dismissX: 0,
                  dismissY: 0,
                  dismissVx: 0,
                  dismissVy: 0,
                  dismissPivotX: action.pointerX,
                  dismissPivotY: action.pointerY,
                  lastUpdatedAt: action.timestamp,
                };
              }
            }
            return state;
          }
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
        }
        throw new Error("unreachable");
      }

      case "dismissing": {
        switch (action.type) {
          case "motion": {
            if (action.itemId !== state.activeItemId) return state;
            const dtMs = computeDtMs(state.lastUpdatedAt, action.timestamp);
            const dismissX = state.dismissX + action.dx;
            const dismissY = state.dismissY + action.dy;
            return {
              ...state,
              dismissX,
              dismissY,
              dismissVx: dtMs > 0 ? action.dx / dtMs : state.dismissVx,
              dismissVy: dtMs > 0 ? action.dy / dtMs : state.dismissVy,
              lastUpdatedAt: action.timestamp,
            };
          }
          case "release": {
            const projectedY = state.dismissY + state.dismissVy / INERTIA_DECAY;
            if (Math.abs(projectedY) > state.itemHeight * 0.5) {
              return {
                type: "dismissed",
                itemWidth: state.itemWidth,
                itemHeight: state.itemHeight,
                itemIds: state.itemIds,
                carousel: state.carousel,
                items: state.items,
                activeItemId: state.activeItemId,
                dismissX: state.dismissX,
                dismissY: state.dismissY,
                dismissPivotX: state.dismissPivotX,
                dismissPivotY: state.dismissPivotY,
              };
            }
            const activeItem = state.items[state.activeItemId];
            const snapScale = deriveDismissScale(
              state.dismissY,
              state.itemHeight,
            );
            return {
              type: "free",
              itemWidth: state.itemWidth,
              itemHeight: state.itemHeight,
              itemIds: state.itemIds,
              carousel: state.carousel,
              items: {
                ...state.items,
                [state.activeItemId]: {
                  type: "snapping" as const,
                  bounds: activeItem?.bounds ?? {
                    elementWidth: state.itemWidth,
                    elementHeight: state.itemHeight,
                    left: 0,
                    right: state.itemWidth,
                    top: 0,
                    bottom: state.itemHeight,
                  },
                  transform: {
                    x: state.dismissX + state.dismissPivotX * (1 - snapScale),
                    y: state.dismissY + state.dismissPivotY * (1 - snapScale),
                    scale: snapScale,
                  },
                  lastUpdatedAt: state.lastUpdatedAt,
                  target: { x: 0, y: 0, scale: 1 },
                },
              },
            };
          }
          case "slop":
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

      case "dismissed": {
        // Returning the same reference satisfies the reference-equality contract,
        // keeping the animation loop paused until the component unmounts.
        return state;
      }
    }
  };
}
