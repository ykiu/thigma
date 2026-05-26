import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "../index.js";
import type { InterpreterEvent, StoreAction, Model } from "../../types.js";

// Store tests use a motion-counting model to verify dispatch drives the loop.
type CounterState = { motionCount: number };
type CounterAction = InterpreterEvent | StoreAction;

function counterReduce(
  state: CounterState | undefined = { motionCount: 0 },
  action: CounterAction,
): CounterState {
  if (action.type === "motion") return { motionCount: state.motionCount + 1 };
  return state;
}

function counterModel<TPublicState>(
  publish: (s: CounterState) => TPublicState,
): Model<TPublicState, CounterState, CounterAction> {
  return { reduce: counterReduce, publish };
}

const motionEvent: InterpreterEvent = {
  type: "motion",
  timestamp: 0,
  dx: 10,
  dy: 0,
  dScale: 1,
  originX: 0,
  originY: 0,
};

// Manual rAF control — lets tests trigger animation frames deterministically
// without depending on fake timer implementation details.
let rafQueue: FrameRequestCallback[] = [];

function flushRaf(timestamp = 16) {
  const pending = rafQueue.splice(0);
  for (const cb of pending) cb(timestamp);
}

beforeEach(() => {
  rafQueue = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createStore", () => {
  it("calls reducer with undefined state on initialization", () => {
    const firstArgs: Array<CounterState | undefined> = [];
    function spyReduce(
      state: CounterState | undefined,
      action: CounterAction,
    ): CounterState {
      firstArgs.push(state);
      return counterReduce(state, action);
    }
    createStore({ reduce: spyReduce, publish: (s) => s });
    expect(firstArgs[0]).toBeUndefined();
  });

  it("notifies subscribers on the first frame with the initial state", () => {
    const store = createStore(counterModel((s) => s));
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].motionCount).toBe(0);

    store.unmount();
  });

  it("pauses the loop when state reference is unchanged after a tick", () => {
    const store = createStore(counterModel((s) => s));
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf(); // initial state emitted, then loop pauses (tick returns same ref)
    expect(snapshots.length).toBe(1);

    flushRaf(); // loop is paused, no new frame scheduled
    expect(snapshots.length).toBe(1);

    store.unmount();
  });

  it("resumes the loop when dispatch changes state", () => {
    const store = createStore(counterModel((s) => s));
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf(); // initial state, then pauses
    expect(snapshots.length).toBe(1);

    store.dispatch(motionEvent);
    flushRaf(); // loop resumed, new state emitted
    expect(snapshots.length).toBe(2);
    expect(snapshots[1].motionCount).toBe(1);

    flushRaf(); // state unchanged again, loop pauses
    expect(snapshots.length).toBe(2);

    store.unmount();
  });

  it("batches multiple dispatches before the next frame", () => {
    const store = createStore(counterModel((s) => s));
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    store.dispatch(motionEvent);
    store.dispatch(motionEvent);

    flushRaf();

    expect(snapshots[0].motionCount).toBe(2);

    store.unmount();
  });

  it("applies publish before notifying subscribers", () => {
    const store = createStore(
      counterModel((state) => ({ doubled: state.motionCount * 2 })),
    );

    const snapshots: { doubled: number }[] = [];
    store.subscribe((s) => snapshots.push(s));

    store.dispatch(motionEvent);
    flushRaf();

    expect(snapshots[0].doubled).toBe(2);

    store.unmount();
  });

  it("stops notifying after unmount", () => {
    const store = createStore(counterModel((s) => s));
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    store.unmount();
    store.dispatch(motionEvent);
    flushRaf();

    expect(snapshots).toHaveLength(0);
  });
});
