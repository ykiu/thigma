import type {
  Interpreter,
  MountedInterpreter,
  Callback,
  InterpreterEvent,
  UnsubscribeFn,
} from "../types.js";

const DOUBLE_TAP_TIME_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;

type DoubleTapState =
  | { type: "idle" }
  | { type: "awaiting_second_tap"; x: number; y: number; timestamp: number };

export function doubleTapInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<InterpreterEvent>>();
    let state: DoubleTapState = { type: "idle" };

    function emit(event: InterpreterEvent) {
      for (const cb of callbacks) cb(event);
    }

    function onDblClick(e: MouseEvent) {
      const rect = element.getBoundingClientRect();
      emit({
        type: "toggle-zoom",
        originX: e.clientX - rect.left,
        originY: e.clientY - rect.top,
        timestamp: e.timeStamp,
      });
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        state = { type: "idle" };
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.changedTouches.length !== 1 || e.touches.length !== 0) {
        state = { type: "idle" };
        return;
      }
      const touch = e.changedTouches[0];
      const x = touch.clientX;
      const y = touch.clientY;
      const timestamp = e.timeStamp;

      if (state.type === "awaiting_second_tap") {
        const dt = timestamp - state.timestamp;
        const dx = x - state.x;
        const dy = y - state.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dt <= DOUBLE_TAP_TIME_MS && dist <= DOUBLE_TAP_DISTANCE_PX) {
          state = { type: "idle" };
          const rect = element.getBoundingClientRect();
          emit({
            type: "toggle-zoom",
            originX: x - rect.left,
            originY: y - rect.top,
            timestamp,
          });
          return;
        }
      }

      state = { type: "awaiting_second_tap", x, y, timestamp };
    }

    function onTouchCancel() {
      state = { type: "idle" };
    }

    element.addEventListener("dblclick", onDblClick as EventListener);
    element.addEventListener("touchstart", onTouchStart as EventListener, {
      passive: true,
    });
    element.addEventListener("touchend", onTouchEnd as EventListener, {
      passive: true,
    });
    element.addEventListener("touchcancel", onTouchCancel as EventListener, {
      passive: true,
    });

    return {
      subscribe(cb: Callback<InterpreterEvent>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        element.removeEventListener("dblclick", onDblClick as EventListener);
        element.removeEventListener(
          "touchstart",
          onTouchStart as EventListener,
        );
        element.removeEventListener("touchend", onTouchEnd as EventListener);
        element.removeEventListener(
          "touchcancel",
          onTouchCancel as EventListener,
        );
        callbacks.clear();
      },
    };
  };
}
