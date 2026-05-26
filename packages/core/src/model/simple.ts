import type { State, Model } from "../types.js";
import {
  type TransformPrivateState,
  type TransformConfig,
  type TransformAction,
  createTransformReduce,
} from "./transform.js";

export type { TransformPrivateState, TransformConfig };

function toPublicState(state: TransformPrivateState): State {
  return {
    transformX: state.transform.x,
    transformY: state.transform.y,
    scale: state.transform.scale,
  };
}

export function createModel(
  config?: TransformConfig,
): Model<State, TransformPrivateState, TransformAction> {
  return { reduce: createTransformReduce(config), publish: toPublicState };
}
