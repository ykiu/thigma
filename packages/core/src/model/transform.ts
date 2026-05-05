import type { StoreAction } from "../types.js";
import {
  type LinearPrimitive,
  type ExponentialPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  computeDtMs,
  applyExponentialFactor,
  advanceExponentialInertia,
  advanceLinearSpring,
  advanceExponentialSpring,
} from "./primitives.js";

export type TransformSnapTarget = { x: number; y: number; scale: number };

export type TransformConfig = {
  elementWidth?: number;
  elementHeight?: number;
  /**
   * Constrains the element so its edges stay within the given coordinates.
   * - `left`/`top`: element's left/top edge must be ≤ this value (maxima)
   * - `right`/`bottom`: element's right/bottom edge must be ≥ this value (minima)
   * Also enforces a minimum scale so the element can always satisfy these constraints.
   */
  bounds?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  snapTarget?: (state: {
    x: LinearPrimitive;
    y: LinearPrimitive;
    scale: ExponentialPrimitive;
  }) => TransformSnapTarget | null;
  /** Scale factor to apply when zooming in via double-tap. Defaults to 2. */
  toggleZoomScale?: number;
};

type Origin = { x: number; y: number };

export type TransformPrivateState =
  | {
      type: "tracking";
      x: LinearPrimitive;
      y: LinearPrimitive;
      scale: ExponentialPrimitive;
      origin: Origin;
    }
  | {
      type: "inertia";
      x: LinearPrimitive;
      y: LinearPrimitive;
      scale: ExponentialPrimitive;
      origin: Origin;
    }
  | {
      type: "snapping";
      x: LinearPrimitive;
      y: LinearPrimitive;
      scale: ExponentialPrimitive;
      target: TransformSnapTarget;
    }
  | {
      type: "settled";
      x: LinearPrimitive;
      y: LinearPrimitive;
      scale: ExponentialPrimitive;
    };

function computeMinScale(
  bounds: NonNullable<TransformConfig["bounds"]>,
  elementWidth: number,
  elementHeight: number,
): number {
  let minScale = 0;
  if (bounds.right != null && elementWidth > 0)
    minScale = Math.max(minScale, bounds.right / elementWidth);
  if (bounds.bottom != null && elementHeight > 0)
    minScale = Math.max(minScale, bounds.bottom / elementHeight);
  return minScale;
}

const SNAP_THRESHOLD = 0.5; // px
const SCALE_SNAP_THRESHOLD = 0.001;
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

export function settleTransform(state: {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
}): Extract<TransformPrivateState, { type: "settled" }> {
  return {
    type: "settled",
    x: { ...state.x, velocity: 0 },
    y: { ...state.y, velocity: 0 },
    scale: { ...state.scale, logVelocity: 0 },
  };
}

export function createTransformReduce(config?: TransformConfig) {
  const {
    bounds,
    snapTarget,
    toggleZoomScale = 2,
    elementWidth = 0,
    elementHeight = 0,
  } = config ?? {};

  function clampPosition(scale: number, x: number, y: number): { x: number; y: number } {
    if (!bounds) return { x, y };
    return {
      x: Math.max(
        bounds.right != null ? bounds.right - elementWidth * scale : -Infinity,
        Math.min(bounds.left ?? Infinity, x),
      ),
      y: Math.max(
        bounds.bottom != null ? bounds.bottom - elementHeight * scale : -Infinity,
        Math.min(bounds.top ?? Infinity, y),
      ),
    };
  }

  function computeToggleZoomTarget(
    state: {
      x: LinearPrimitive;
      y: LinearPrimitive;
      scale: ExponentialPrimitive;
    },
    originX: number,
    originY: number,
  ): TransformSnapTarget {
    if (Math.abs(state.scale.value - 1) < 0.01) {
      const ds = toggleZoomScale / state.scale.value;
      let targetX = originX * (1 - ds) + state.x.value * ds;
      let targetY = originY * (1 - ds) + state.y.value * ds;
      ({ x: targetX, y: targetY } = clampPosition(toggleZoomScale, targetX, targetY));
      return { x: targetX, y: targetY, scale: toggleZoomScale };
    }
    return { x: 0, y: 0, scale: 1 };
  }

  return function reduce(
    state: TransformPrivateState | undefined = {
      type: "settled",
      x: createLinearPrimitive(0),
      y: createLinearPrimitive(0),
      scale: createExponentialPrimitive(1),
    },
    action: StoreAction,
  ): TransformPrivateState {
    switch (state.type) {
      case "tracking": {
        switch (action.type) {
          case "motion": {
            const { dx, dy, dScale, originX, originY, timestamp } = action;
            const tx = state.x.value;
            const ty = state.y.value;

            // Clamp dScale so scale cannot go below the minimum required by bounds.
            let effectiveDScale = dScale;
            if (bounds && state.scale.value > 0) {
              const minScale = computeMinScale(
                bounds,
                elementWidth,
                elementHeight,
              );
              effectiveDScale = Math.max(dScale, minScale / state.scale.value);
            }
            const newScale = state.scale.value * effectiveDScale;

            const proposedTx = originX + (tx - originX) * effectiveDScale + dx;
            const proposedTy = originY + (ty - originY) * effectiveDScale + dy;

            const { x: clampedTx, y: clampedTy } = clampPosition(newScale, proposedTx, proposedTy);

            // Velocity tracks pan-only contribution so that advanceInertia can
            // handle the scale-pivot effect separately without double-counting.
            const dtMs = computeDtMs(state.x.lastUpdatedAt, timestamp);
            const scalePivotTx = originX + (tx - originX) * effectiveDScale;
            const scalePivotTy = originY + (ty - originY) * effectiveDScale;

            return {
              type: "tracking",
              origin: { x: originX, y: originY },
              x: {
                value: clampedTx,
                velocity: dtMs > 0 ? (clampedTx - scalePivotTx) / dtMs : 0,
                lastUpdatedAt: timestamp,
              },
              y: {
                value: clampedTy,
                velocity: dtMs > 0 ? (clampedTy - scalePivotTy) / dtMs : 0,
                lastUpdatedAt: timestamp,
              },
              scale: applyExponentialFactor(
                state.scale,
                effectiveDScale,
                timestamp,
              ),
            };
          }
          case "release": {
            if (snapTarget) {
              const target = snapTarget(state);
              if (target)
                return {
                  type: "snapping",
                  x: state.x,
                  y: state.y,
                  scale: state.scale,
                  target,
                };
            }
            return {
              type: "inertia",
              x: state.x,
              y: state.y,
              scale: state.scale,
              origin: state.origin,
            };
          }
          case "tick":
            return state;
          case "toggle-zoom":
            return state;
        }
        throw new Error("unreachable");
      }
      case "inertia": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              origin: state.origin,
              x: state.x,
              y: state.y,
              scale: state.scale,
            };
          case "release":
            return state;
          case "tick": {
            const timestamp = action.timestamp;
            if (
              Math.abs(state.x.velocity) < VELOCITY_THRESHOLD &&
              Math.abs(state.y.velocity) < VELOCITY_THRESHOLD &&
              Math.abs(state.scale.logVelocity) < LOG_VELOCITY_THRESHOLD
            ) {
              return settleTransform(state);
            }
            // Advance inertia
            const oldScale = state.scale.value;
            const newScale = advanceExponentialInertia(state.scale, timestamp);
            const ds = newScale.value / oldScale;

            const dtMs = computeDtMs(state.x.lastUpdatedAt, timestamp);
            const retainedFactor = 0.99 ** dtMs;
            const newVx = state.x.velocity * retainedFactor;
            const newVy = state.y.velocity * retainedFactor;

            let finalScale = newScale;
            let newX = {
              value:
                state.origin.x +
                (state.x.value - state.origin.x) * ds +
                newVx * dtMs,
              velocity: newVx,
              lastUpdatedAt: timestamp,
            };
            let newY = {
              value:
                state.origin.y +
                (state.y.value - state.origin.y) * ds +
                newVy * dtMs,
              velocity: newVy,
              lastUpdatedAt: timestamp,
            };

            if (bounds) {
              const minScale = computeMinScale(
                bounds,
                elementWidth,
                elementHeight,
              );
              if (newScale.value < minScale) {
                finalScale = {
                  value: minScale,
                  logVelocity: 0,
                  lastUpdatedAt: timestamp,
                };
                const clamped = clampPosition(minScale, newX.value, newY.value);
                newX = { ...newX, value: clamped.x };
                newY = { ...newY, value: clamped.y };
              }
            }

            return { ...state, x: newX, y: newY, scale: finalScale };
          }
          case "toggle-zoom":
            return {
              type: "snapping",
              x: state.x,
              y: state.y,
              scale: state.scale,
              target: computeToggleZoomTarget(
                state,
                action.originX,
                action.originY,
              ),
            };
        }
        throw new Error("unreachable");
      }
      case "snapping": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              origin: { x: 0, y: 0 },
              x: state.x,
              y: state.y,
              scale: state.scale,
            };
          case "release":
            return state;
          case "toggle-zoom":
            return state;
          case "tick": {
            if (
              Math.abs(state.x.value - state.target.x) < SNAP_THRESHOLD &&
              Math.abs(state.y.value - state.target.y) < SNAP_THRESHOLD &&
              Math.abs(state.scale.value - state.target.scale) <
                SCALE_SNAP_THRESHOLD
            ) {
              return {
                type: "settled",
                x: {
                  value: state.target.x,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
                y: {
                  value: state.target.y,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
                scale: {
                  value: state.target.scale,
                  logVelocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
              };
            }
            return {
              ...state,
              x: advanceLinearSpring(state.x, state.target.x, action.timestamp),
              y: advanceLinearSpring(state.y, state.target.y, action.timestamp),
              scale: advanceExponentialSpring(
                state.scale,
                state.target.scale,
                action.timestamp,
              ),
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
                origin: { x: 0, y: 0 },
                x: state.x,
                y: state.y,
                scale: state.scale,
              },
              action,
            );
          case "release":
            return state;
          case "tick":
            return state;
          case "toggle-zoom":
            return {
              type: "snapping",
              x: state.x,
              y: state.y,
              scale: state.scale,
              target: computeToggleZoomTarget(
                state,
                action.originX,
                action.originY,
              ),
            };
        }
        throw new Error("unreachable");
      }
    }
  };
}
