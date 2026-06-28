import type { InterpreterEvent, StoreAction } from "../types.js";

export type TransformAction =
  | InterpreterEvent
  | StoreAction
  | { type: "set-bounds"; bounds: BoundsConfig | undefined };

import {
  type Transform,
  type TransformVelocity,
  computeDtMs,
  applyScalePivot,
} from "./primitives.js";

export type TransformSnapTarget = { x: number; y: number; scale: number };

/**
 * Constrains the element so its edges stay within the given coordinates.
 * - `left`/`top`: element's left/top edge must be ≤ this value (maxima)
 * - `right`/`bottom`: element's right/bottom edge must be ≥ this value (minima)
 * Also enforces a minimum scale so the element can always satisfy these constraints.
 */
export type BoundsConfig = {
  elementWidth: number;
  elementHeight: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
};

export type TransformConfig = {
  snapTarget?: (state: {
    transform: Transform;
    velocity: TransformVelocity;
  }) => TransformSnapTarget | null;
  /** Scale factor to apply when zooming in via double-tap. Defaults to 2. */
  toggleZoomScale?: number;
};

type Origin = { x: number; y: number };

export type TransformPrivateState =
  | {
      type: "tracking";
      bounds?: BoundsConfig;
      transform: Transform;
      velocity: TransformVelocity;
      lastUpdatedAt: number;
      origin: Origin;
    }
  | {
      type: "inertia";
      bounds?: BoundsConfig;
      transform: Transform;
      velocity: TransformVelocity;
      lastUpdatedAt: number;
      origin: Origin;
    }
  | {
      type: "snapping";
      bounds?: BoundsConfig;
      transform: Transform;
      lastUpdatedAt: number;
      target: TransformSnapTarget;
    }
  | {
      type: "settled";
      bounds?: BoundsConfig;
      transform: Transform;
      lastUpdatedAt: number;
    };

function computeMinScale(bounds: BoundsConfig): number {
  const { elementWidth, elementHeight } = bounds;
  let minScale = 0;
  if (bounds.right != null && elementWidth > 0)
    minScale = Math.max(minScale, bounds.right / elementWidth);
  if (bounds.bottom != null && elementHeight > 0)
    minScale = Math.max(minScale, bounds.bottom / elementHeight);
  return minScale;
}

const SNAP_DECAY = 0.80; // per-frame interpolation factor toward snap target
const SNAP_THRESHOLD = 0.5; // px
const SCALE_SNAP_THRESHOLD = 0.001;
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms
const TRANSLATE_INERTIA_DECAY = 0.99; // fraction of velocity retained per ms
const SCALE_LOG_INERTIA_DECAY = 0.98; // fraction of log-velocity retained per ms

export function settleTransform(state: {
  bounds?: BoundsConfig;
  transform: Transform;
  lastUpdatedAt: number;
}): Extract<TransformPrivateState, { type: "settled" }> {
  return {
    type: "settled",
    bounds: state.bounds,
    transform: state.transform,
    lastUpdatedAt: state.lastUpdatedAt,
  };
}

export function createTransformReduce(config?: TransformConfig) {
  const { snapTarget, toggleZoomScale = 2 } = config ?? {};

  function clampPosition(
    bounds: BoundsConfig | undefined,
    scale: number,
    x: number,
    y: number,
  ): { x: number; y: number } {
    if (!bounds) return { x, y };
    const { elementWidth, elementHeight } = bounds;
    return {
      x: Math.max(
        bounds.right != null ? bounds.right - elementWidth * scale : -Infinity,
        Math.min(bounds.left ?? Infinity, x),
      ),
      y: Math.max(
        bounds.bottom != null
          ? bounds.bottom - elementHeight * scale
          : -Infinity,
        Math.min(bounds.top ?? Infinity, y),
      ),
    };
  }

  function computeToggleZoomTarget(
    state: { bounds?: BoundsConfig; transform: Transform },
    originX: number,
    originY: number,
  ): TransformSnapTarget {
    if (Math.abs(state.transform.scale - 1) < 0.01) {
      const ds = toggleZoomScale / state.transform.scale;
      let { x: targetX, y: targetY } = applyScalePivot(
        state.transform,
        ds,
        originX,
        originY,
      );
      ({ x: targetX, y: targetY } = clampPosition(
        state.bounds,
        toggleZoomScale,
        targetX,
        targetY,
      ));
      return { x: targetX, y: targetY, scale: toggleZoomScale };
    }
    return { x: 0, y: 0, scale: 1 };
  }

  return function reduce(
    state: TransformPrivateState | undefined = {
      type: "settled",
      transform: { x: 0, y: 0, scale: 1 },
      lastUpdatedAt: NaN,
    },
    action: TransformAction,
  ): TransformPrivateState {
    if (action.type === "set-bounds") {
      return { ...state, bounds: action.bounds };
    }

    switch (state.type) {
      case "tracking": {
        switch (action.type) {
          case "motion": {
            const { dx, dy, dScale, originX, originY, timestamp } = action;

            // Clamp dScale so scale cannot go below the minimum required by bounds.
            let effectiveDScale = dScale;
            const { bounds } = state;
            if (bounds) {
              const minScale = computeMinScale(bounds);
              effectiveDScale = Math.max(
                dScale,
                minScale / state.transform.scale,
              );
            }
            const newScale = state.transform.scale * effectiveDScale;

            // Pan-only velocity avoids double-counting the scale-pivot effect in the inertia tick.
            const dtMs = computeDtMs(state.lastUpdatedAt, timestamp);
            const pivoted = applyScalePivot(
              state.transform,
              effectiveDScale,
              originX,
              originY,
            );
            const proposedX = pivoted.x + dx;
            const proposedY = pivoted.y + dy;

            const { x: clampedX, y: clampedY } = clampPosition(
              bounds,
              newScale,
              proposedX,
              proposedY,
            );

            return {
              type: "tracking",
              bounds: state.bounds,
              origin: { x: originX, y: originY },
              transform: { x: clampedX, y: clampedY, scale: newScale },
              velocity: {
                vx: dtMs > 0 ? (clampedX - pivoted.x) / dtMs : 0,
                vy: dtMs > 0 ? (clampedY - pivoted.y) / dtMs : 0,
                logVScale: dtMs > 0 ? Math.log(effectiveDScale) / dtMs : 0,
              },
              lastUpdatedAt: timestamp,
            };
          }
          case "release": {
            if (snapTarget) {
              const target = snapTarget({
                transform: state.transform,
                velocity: state.velocity,
              });
              if (target)
                return {
                  type: "snapping",
                  bounds: state.bounds,
                  transform: state.transform,
                  lastUpdatedAt: state.lastUpdatedAt,
                  target,
                };
            }
            return {
              type: "inertia",
              bounds: state.bounds,
              transform: state.transform,
              velocity: state.velocity,
              lastUpdatedAt: state.lastUpdatedAt,
              origin: state.origin,
            };
          }
          case "tick":
            return state;
          case "toggle-zoom":
            return state;
          case "slop":
            return state;
        }
        throw new Error("unreachable");
      }
      case "inertia": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              bounds: state.bounds,
              origin: state.origin,
              transform: state.transform,
              velocity: state.velocity,
              lastUpdatedAt: state.lastUpdatedAt,
            };
          case "release":
            return state;
          case "slop":
            return state;
          case "tick": {
            const timestamp = action.timestamp;
            if (
              Math.abs(state.velocity.vx) < VELOCITY_THRESHOLD &&
              Math.abs(state.velocity.vy) < VELOCITY_THRESHOLD &&
              Math.abs(state.velocity.logVScale) < LOG_VELOCITY_THRESHOLD
            ) {
              return settleTransform(state);
            }

            const dtMs = computeDtMs(state.lastUpdatedAt, timestamp);

            // Advance scale inertia in log-space.
            const logScaleRetained = SCALE_LOG_INERTIA_DECAY ** dtMs;
            let newLogVScale = state.velocity.logVScale * logScaleRetained;
            let newScale =
              state.transform.scale * Math.exp(newLogVScale * dtMs);

            const { bounds } = state;
            if (bounds) {
              const minScale = computeMinScale(bounds);
              if (newScale < minScale) {
                newScale = minScale;
                newLogVScale = 0;
0            }
            }
            const ds = newScale / state.transform.scale;

            // Advance translate inertia; apply scale pivot to couple with scale change.
            const translateRetained = TRANSLATE_INERTIA_DECAY ** dtMs;
            const newVx = state.velocity.vx * translateRetained;
            const newVy = state.velocity.vy * translateRetained;

            const pivoted = applyScalePivot(
              state.transform,
              ds,
              state.origin.x,
              state.origin.y,
            );
            const clamped = clampPosition(
              bounds,
              newScale,
              pivoted.x + newVx * dtMs,
              pivoted.y + newVy * dtMs,
            );

            return {
              ...state,
              transform: { x: clamped.x, y: clamped.y, scale: newScale },
              velocity: { vx: newVx, vy: newVy, logVScale: newLogVScale },
              lastUpdatedAt: timestamp,
            };
          }
          case "toggle-zoom": {
            const target = computeToggleZoomTarget(
              state,
              action.originX,
              action.originY,
            );
            return {
              type: "snapping",
              bounds: state.bounds,
              transform: state.transform,
              lastUpdatedAt: state.lastUpdatedAt,
              target,
            };
          }
        }
        throw new Error("unreachable");
      }
      case "snapping": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              bounds: state.bounds,
              origin: { x: 0, y: 0 },
              transform: state.transform,
              velocity: { vx: 0, vy: 0, logVScale: 0 },
              lastUpdatedAt: state.lastUpdatedAt,
            };
          case "release":
            return state;
          case "toggle-zoom":
            return state;
          case "slop":
            return state;
          case "tick": {
            if (
              Math.abs(state.transform.x - state.target.x) < SNAP_THRESHOLD &&
              Math.abs(state.transform.y - state.target.y) < SNAP_THRESHOLD &&
              Math.abs(state.transform.scale - state.target.scale) <
                SCALE_SNAP_THRESHOLD
            ) {
              return {
                type: "settled",
                bounds: state.bounds,
                transform: state.target,
                lastUpdatedAt: action.timestamp,
              };
            }
            return {
              ...state,
              transform: {
                x:
                  state.target.x +
                  (state.transform.x - state.target.x) * SNAP_DECAY,
                y:
                  state.target.y +
                  (state.transform.y - state.target.y) * SNAP_DECAY,
                scale:
                  state.target.scale +
                  (state.transform.scale - state.target.scale) * SNAP_DECAY,
              },
              lastUpdatedAt: action.timestamp,
            };
          }
        }
        throw new Error("unreachable");
      }
      case "settled": {
        switch (action.type) {
          case "motion":
            // Transition to tracking then immediately apply the delta.
            return reduce(
              {
                type: "tracking",
                bounds: state.bounds,
                origin: { x: 0, y: 0 },
                transform: state.transform,
                velocity: { vx: 0, vy: 0, logVScale: 0 },
                lastUpdatedAt: state.lastUpdatedAt,
              },
              action,
            );
          case "release":
            return state;
          case "tick":
            return state;
          case "slop":
            return state;
          case "toggle-zoom": {
            const target = computeToggleZoomTarget(
              state,
              action.originX,
              action.originY,
            );
            return {
              type: "snapping",
              bounds: state.bounds,
              transform: state.transform,
              lastUpdatedAt: state.lastUpdatedAt,
              target,
            };
          }
        }
        throw new Error("unreachable");
      }
    }
  };
}
