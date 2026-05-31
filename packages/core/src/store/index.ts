import type {
  Store,
  Callback,
  UnsubscribeFn,
  Model,
  StoreAction,
} from "../types.js";

export function createStore<TPrivateState, TState, TExtraAction = never>(
  model: Model<TState, TPrivateState, StoreAction | TExtraAction>,
): Store<TState, StoreAction | TExtraAction> {
  const callbacks = new Set<Callback<TState>>();

  let state = model.reduce(undefined, { type: "tick", timestamp: 0 });
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
    for (const cb of callbacks) cb(publicState);
    rafId = requestAnimationFrame(loop);
  }

  function resumeLoop() {
    if (rafId === null && mounted) {
      rafId = requestAnimationFrame(loop);
    }
  }

  rafId = requestAnimationFrame(loop);

  return {
    subscribe(cb: Callback<TState>): UnsubscribeFn {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    dispatch(action: StoreAction | TExtraAction) {
      state = model.reduce(state, action);
      resumeLoop();
    },
    flush() {
      lastEmittedState = state;
      const publicState = model.publish(state);
      for (const cb of callbacks) cb(publicState);
    },
    unmount() {
      mounted = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      callbacks.clear();
    },
  };
}
