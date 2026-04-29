import type { State, StoreAction, Model } from "../types.js";
import {
  type TransformPrivateState,
  type TransformConfig,
  createTransformReduce,
} from "./transform.js";

export type { TransformPrivateState, TransformConfig };

function toPublicState(state: TransformPrivateState): State {
  return {
    transformX: state.x.value,
    transformY: state.y.value,
    scale: state.scale.value,
  };
}

export function createModel(
  config?: TransformConfig,
): Model<State, TransformPrivateState, StoreAction> {
  return { reduce: createTransformReduce(config), publish: toPublicState };
}
