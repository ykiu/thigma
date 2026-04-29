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
  bounds?: (scale: number) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  snapTarget?: (state: {
    x: LinearPrimitive;
    y: LinearPrimitive;
    scale: ExponentialPrimitive;
  }) => TransformSnapTarget | null;
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
  const { bounds, snapTarget } = config ?? {};

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
            const newScale = state.scale.value * dScale;

            const proposedTx = originX + (tx - originX) * dScale + dx;
            const proposedTy = originY + (ty - originY) * dScale + dy;

            let clampedTx = proposedTx;
            let clampedTy = proposedTy;
            if (bounds) {
              const b = bounds(newScale);
              clampedTx = Math.max(b.minX, Math.min(b.maxX, proposedTx));
              clampedTy = Math.max(b.minY, Math.min(b.maxY, proposedTy));
            }

            // Velocity tracks pan-only contribution so that advanceInertia can
            // handle the scale-pivot effect separately without double-counting.
            const dtMs = computeDtMs(state.x.lastUpdatedAt, timestamp);
            const scalePivotTx = originX + (tx - originX) * dScale;
            const scalePivotTy = originY + (ty - originY) * dScale;

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
              scale: applyExponentialFactor(state.scale, dScale, timestamp),
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
            return settleTransform(state);
          }
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

            return {
              ...state,
              x: {
                value:
                  state.origin.x +
                  (state.x.value - state.origin.x) * ds +
                  newVx * dtMs,
                velocity: newVx,
                lastUpdatedAt: timestamp,
              },
              y: {
                value:
                  state.origin.y +
                  (state.y.value - state.origin.y) * ds +
                  newVy * dtMs,
                velocity: newVy,
                lastUpdatedAt: timestamp,
              },
              scale: newScale,
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
              origin: { x: 0, y: 0 },
              x: state.x,
              y: state.y,
              scale: state.scale,
            };
          case "release":
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
            return {
              type: "tracking",
              origin: { x: 0, y: 0 },
              x: state.x,
              y: state.y,
              scale: state.scale,
            };
          case "release":
            return state;
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
    }
  };
}
