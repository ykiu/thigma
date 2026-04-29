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

export type Transform = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

export type TransformSnapTarget = { x: number; y: number; scale: number };

export type TransformConfig = {
  bounds?: (scale: number) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  snapTarget?: (transform: Transform) => TransformSnapTarget | null;
};

type Origin = { x: number; y: number };

export type TransformPrivateState =
  | { type: "tracking"; transform: Transform; origin: Origin }
  | { type: "inertia"; transform: Transform; origin: Origin }
  | { type: "snapping"; transform: Transform; target: TransformSnapTarget }
  | { type: "settled"; transform: Transform };

const SNAP_THRESHOLD = 0.5; // px
const SCALE_SNAP_THRESHOLD = 0.001;
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

function hasSignificantVelocity(transform: Transform): boolean {
  return (
    Math.abs(transform.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

function advanceInertia(
  transform: Transform,
  origin: Origin,
  timestamp: number,
): Transform {
  const oldScale = transform.scale.value;
  const newScale = advanceExponentialInertia(transform.scale, timestamp);
  const ds = newScale.value / oldScale;

  const dtMs = computeDtMs(transform.x.lastUpdatedAt, timestamp);
  const retainedFactor = 0.99 ** dtMs;
  const newVx = transform.x.velocity * retainedFactor;
  const newVy = transform.y.velocity * retainedFactor;

  return {
    x: {
      value: origin.x + (transform.x.value - origin.x) * ds + newVx * dtMs,
      velocity: newVx,
      lastUpdatedAt: timestamp,
    },
    y: {
      value: origin.y + (transform.y.value - origin.y) * ds + newVy * dtMs,
      velocity: newVy,
      lastUpdatedAt: timestamp,
    },
    scale: newScale,
  };
}

function advanceSpring(
  transform: Transform,
  target: TransformSnapTarget,
  timestamp: number,
): Transform {
  return {
    x: advanceLinearSpring(transform.x, target.x, timestamp),
    y: advanceLinearSpring(transform.y, target.y, timestamp),
    scale: advanceExponentialSpring(transform.scale, target.scale, timestamp),
  };
}

function isSnapSettled(
  transform: Transform,
  target: TransformSnapTarget,
): boolean {
  return (
    Math.abs(transform.x.value - target.x) < SNAP_THRESHOLD &&
    Math.abs(transform.y.value - target.y) < SNAP_THRESHOLD &&
    Math.abs(transform.scale.value - target.scale) < SCALE_SNAP_THRESHOLD
  );
}

export function settleTransform(transform: Transform): Transform {
  return {
    x: {
      value: transform.x.value,
      velocity: 0,
      lastUpdatedAt: transform.x.lastUpdatedAt,
    },
    y: {
      value: transform.y.value,
      velocity: 0,
      lastUpdatedAt: transform.y.lastUpdatedAt,
    },
    scale: {
      value: transform.scale.value,
      logVelocity: 0,
      lastUpdatedAt: transform.scale.lastUpdatedAt,
    },
  };
}

function settleAtTarget(
  target: TransformSnapTarget,
  timestamp: number,
): Transform {
  return {
    x: { value: target.x, velocity: 0, lastUpdatedAt: timestamp },
    y: { value: target.y, velocity: 0, lastUpdatedAt: timestamp },
    scale: { value: target.scale, logVelocity: 0, lastUpdatedAt: timestamp },
  };
}

export function createTransformReduce(config?: TransformConfig) {
  const { bounds, snapTarget } = config ?? {};

  return function reduce(
    state: TransformPrivateState | undefined = {
      type: "settled",
      transform: {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
    },
    action: StoreAction,
  ): TransformPrivateState {
    switch (state.type) {
      case "tracking": {
        switch (action.type) {
          case "motion": {
            const { dx, dy, dScale, originX, originY, timestamp } = action;
            const tx = state.transform.x.value;
            const ty = state.transform.y.value;
            const newScale = state.transform.scale.value * dScale;

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
            const dtMs = computeDtMs(
              state.transform.x.lastUpdatedAt,
              timestamp,
            );
            const scalePivotTx = originX + (tx - originX) * dScale;
            const scalePivotTy = originY + (ty - originY) * dScale;

            return {
              type: "tracking",
              origin: { x: originX, y: originY },
              transform: {
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
                  state.transform.scale,
                  dScale,
                  timestamp,
                ),
              },
            };
          }
          case "release": {
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target)
                return { type: "snapping", transform: state.transform, target };
            }
            if (hasSignificantVelocity(state.transform)) {
              return {
                type: "inertia",
                transform: state.transform,
                origin: state.origin,
              };
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
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
              transform: state.transform,
            };
          case "release": {
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target)
                return { type: "snapping", transform: state.transform, target };
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
            };
          }
          case "tick": {
            if (hasSignificantVelocity(state.transform)) {
              return {
                ...state,
                transform: advanceInertia(
                  state.transform,
                  state.origin,
                  action.timestamp,
                ),
              };
            }
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target) {
                if (isSnapSettled(state.transform, target)) {
                  return {
                    type: "settled",
                    transform: settleAtTarget(target, action.timestamp),
                  };
                }
                return { type: "snapping", transform: state.transform, target };
              }
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
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
              transform: state.transform,
            };
          case "release":
            return state;
          case "tick": {
            const { target } = state;
            if (isSnapSettled(state.transform, target)) {
              return {
                type: "settled",
                transform: settleAtTarget(target, action.timestamp),
              };
            }
            return {
              ...state,
              transform: advanceSpring(
                state.transform,
                target,
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
              transform: state.transform,
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
