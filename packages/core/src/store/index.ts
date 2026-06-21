import type {
  Store,
  StateCallback,
  UnsubscribeFn,
  Model,
  StoreAction,
} from "../types.js";

export function createStore<TPrivateState, TState, TExtraAction = never>(
  model: Model<TState, TPrivateState, StoreAction | TExtraAction>,
): Store<TState, StoreAction | TExtraAction> {
  const callbacks = new Set<StateCallback<TState>>();

  let state = model.reduce(undefined, { type: "tick", timestamp: 0 });
  let lastEmittedPublicState: TState | undefined;
  let lastEmittedState: TPrivateState | undefined;

  let rafId: number | null = null;
  let mounted = true;

  function loop(timestamp: number) {
    if (!mounted) return;
    state = model.reduce(state, { type: "tick", timestamp });
    if (state === lastEmittedState) {
      rafId = null;
      return;
    }
    lastEmittedState = state;
    const publicState = model.publish(state);
    const prevPublicState = lastEmittedPublicState ?? publicState;
    lastEmittedPublicState = publicState;
    for (const cb of callbacks) cb(publicState, prevPublicState);
    rafId = requestAnimationFrame(loop);
  }

  function resumeLoop() {
    if (rafId === null && mounted) {
      rafId = requestAnimationFrame(loop);
    }
  }

  rafId = requestAnimationFrame(loop);

  return {
    subscribe(cb: StateCallback<TState>): UnsubscribeFn {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    dispatch(action: StoreAction | TExtraAction) {
      state = model.reduce(state, action);
      resumeLoop();
    },
    flush() {
      const publicState = model.publish(state);
      const prevPublicState = lastEmittedPublicState ?? publicState;
      lastEmittedPublicState = publicState;
      lastEmittedState = state;
      for (const cb of callbacks) cb(publicState, prevPublicState);
    },
    unmount() {
      mounted = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      callbacks.clear();
    },
  };
}
