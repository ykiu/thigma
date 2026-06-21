export type UnsubscribeFn = () => void;
export type UnmountFn = () => void;
export type InterpreterCallback<T> = (value: T) => void;
export type StateCallback<T> = (state: T, prevState: T) => void;

export type InterpreterEvent =
  | {
      type: "motion";
      /** Identifies the item being interacted with. Absent for container-level gestures. */
      itemId?: string;
      dx: number;
      dy: number;
      dScale: number;
      originX: number;
      originY: number;
      timestamp: number;
    }
  | {
      type: "slop";
      /** Identifies the item being interacted with. Absent for container-level gestures. */
      itemId?: string;
      dx: number;
      dy: number;
      dScale: number;
      originX: number;
      originY: number;
      timestamp: number;
    }
  | {
      type: "release";
      /** Identifies the item being released. Absent for container-level gestures. */
      itemId?: string;
    }
  | {
      type: "toggle-zoom";
      /** Identifies the item being double-tapped. Absent for container-level gestures. */
      itemId?: string;
      /** Double-tap position relative to the element's top-left corner (px). */
      originX: number;
      originY: number;
      timestamp: number;
    };

// TODO: Move to a new module
export type State = {
  transformX: number;
  transformY: number;
  scale: number;
};

export type MountedInterpreter = {
  subscribe: (cb: InterpreterCallback<InterpreterEvent>) => UnsubscribeFn;
  unmount: UnmountFn;
};

export type Interpreter = (element: HTMLElement) => MountedInterpreter;

export type Store<TState, TAction = StoreAction> = {
  subscribe: (cb: StateCallback<TState>) => UnsubscribeFn;
  dispatch: (action: TAction) => void;
  flush: () => void;
  unmount: UnmountFn;
};

export type StoreAction = { type: "tick"; timestamp: number };

/**
 * A pure function that computes the next private state from the current state and an action.
 *
 * **Reference equality contract**: when the state is unchanged, return the same object reference.
 * The Store uses reference equality (`===`) to detect when the state has settled and pauses the
 * animation loop accordingly. Returning a new object with identical values defeats this optimization.
 */
export type Reducer<TPrivateState, TAction = StoreAction> = (
  state: TPrivateState | undefined,
  action: TAction,
) => TPrivateState;

export interface Model<TPublicState, TPrivateState, TAction = StoreAction> {
  reduce: Reducer<TPrivateState, TAction>;
  publish(state: TPrivateState): TPublicState;
}

export type MountedRenderer = {
  unmount: UnmountFn;
};

export type Renderer<TState> = (
  element: Element,
  store: Store<TState>,
) => MountedRenderer;
