import type {
  Store,
  MountedStore,
  MountedInterpreter,
  Callback,
  UnsubscribeFn,
  UnmountFn,
  Model,
  StoreAction,
} from "../types.js";

export function createStore<TPrivateState, TState, TAction = StoreAction>(
  model: Model<TState, TPrivateState, TAction>,
): Store<TState, TAction> {
  return (
    interpreters: MountedInterpreter[],
  ): MountedStore<TState, TAction> => {
    const callbacks = new Set<Callback<TState>>();

    let state = model.reduce(undefined, {
      type: "tick",
      timestamp: 0,
    } as unknown as TAction);
    let lastEmittedState: TPrivateState | undefined;

    let rafId: number | null = null;
    let mounted = true;

    function loop(timestamp: number) {
      if (!mounted) return;
      state = model.reduce(state, {
        type: "tick",
        timestamp,
      } as unknown as TAction);
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

    function dispatch(action: TAction) {
      state = model.reduce(state, action);
      resumeLoop();
    }

    function mount(interp: MountedInterpreter): UnmountFn {
      return interp.subscribe((event) => {
        dispatch(event as unknown as TAction);
      });
    }

    const unsubscribers: UnsubscribeFn[] = interpreters.map(mount);

    rafId = requestAnimationFrame(loop);

    return {
      subscribe(cb: Callback<TState>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      dispatch,
      mount,
      unmount() {
        mounted = false;
        if (rafId !== null) cancelAnimationFrame(rafId);
        for (const unsub of unsubscribers) unsub();
        callbacks.clear();
      },
    };
  };
}
