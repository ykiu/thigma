import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InterpreterEvent } from "../../types.js";
import { doubleTapInterpreter } from "../double-tap.js";

function makeTouch(id: number, x: number, y: number): Touch {
  return {
    identifier: id,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    target: document.body,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
    altitudeAngle: 0,
    azimuthAngle: 0,
    touchType: "direct",
  } as unknown as Touch;
}

/** touchstart with the given active touches */
function makeTouchStartEvent(touches: Touch[]): TouchEvent {
  return new TouchEvent("touchstart", {
    touches,
    changedTouches: touches,
    bubbles: true,
    cancelable: true,
  });
}

/** touchend where `ended` was lifted and no touches remain */
function makeTouchEndEvent(ended: Touch): TouchEvent {
  return new TouchEvent("touchend", {
    touches: [],
    changedTouches: [ended],
    bubbles: true,
    cancelable: true,
  });
}

describe("doubleTapInterpreter", () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  // -------------------------------------------------------------------------
  // Mouse (dblclick)
  // -------------------------------------------------------------------------

  it("emits toggle-zoom on dblclick", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 100, clientY: 80, bubbles: true }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("toggle-zoom");
    interpreter.unmount();
  });

  it("sets dblclick origin relative to element top-left", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 30,
      right: 250,
      bottom: 230,
      width: 200,
      height: 200,
      x: 50,
      y: 30,
      toJSON: () => {},
    });

    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 150, clientY: 130, bubbles: true }),
    );

    expect(events[0].type).toBe("toggle-zoom");
    if (events[0].type === "toggle-zoom") {
      expect(events[0].originX).toBe(100); // 150 - 50
      expect(events[0].originY).toBe(100); // 130 - 30
    }
    interpreter.unmount();
  });

  // -------------------------------------------------------------------------
  // Touch
  // -------------------------------------------------------------------------

  it("does not emit on a single tap", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    const touch = makeTouch(0, 100, 100);
    element.dispatchEvent(makeTouchStartEvent([touch]));
    element.dispatchEvent(makeTouchEndEvent(touch));

    expect(events).toHaveLength(0);
    interpreter.unmount();
  });

  it("emits toggle-zoom on touch double-tap at same location", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    const touch = makeTouch(0, 100, 100);
    element.dispatchEvent(makeTouchStartEvent([touch]));
    element.dispatchEvent(makeTouchEndEvent(touch));
    element.dispatchEvent(makeTouchStartEvent([touch]));
    element.dispatchEvent(makeTouchEndEvent(touch));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("toggle-zoom");
    interpreter.unmount();
  });

  it("sets touch double-tap origin relative to element top-left", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 10,
      right: 220,
      bottom: 210,
      width: 200,
      height: 200,
      x: 20,
      y: 10,
      toJSON: () => {},
    });

    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    const touch = makeTouch(0, 120, 110);
    element.dispatchEvent(makeTouchStartEvent([touch]));
    element.dispatchEvent(makeTouchEndEvent(touch));
    element.dispatchEvent(makeTouchStartEvent([touch]));
    element.dispatchEvent(makeTouchEndEvent(touch));

    expect(events[0].type).toBe("toggle-zoom");
    if (events[0].type === "toggle-zoom") {
      expect(events[0].originX).toBe(100); // 120 - 20
      expect(events[0].originY).toBe(100); // 110 - 10
    }
    interpreter.unmount();
  });

  it("does not emit when second tap is too far from first", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    const touch1 = makeTouch(0, 100, 100);
    const touch2 = makeTouch(0, 200, 200); // ~141 px away

    element.dispatchEvent(makeTouchStartEvent([touch1]));
    element.dispatchEvent(makeTouchEndEvent(touch1));
    element.dispatchEvent(makeTouchStartEvent([touch2]));
    element.dispatchEvent(makeTouchEndEvent(touch2));

    expect(events).toHaveLength(0);
    interpreter.unmount();
  });

  it("resets state on multi-touch: tap after multi-touch does not count as second of a pair", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));

    const touch1 = makeTouch(0, 100, 100);
    const touch2 = makeTouch(1, 150, 100);

    // First tap → awaiting
    element.dispatchEvent(makeTouchStartEvent([touch1]));
    element.dispatchEvent(makeTouchEndEvent(touch1));

    // Multi-touch → state resets to idle
    element.dispatchEvent(makeTouchStartEvent([touch1, touch2]));

    // Single tap → this becomes a fresh first tap (not a second tap)
    element.dispatchEvent(makeTouchStartEvent([touch1]));
    element.dispatchEvent(makeTouchEndEvent(touch1));

    expect(events).toHaveLength(0); // no toggle-zoom yet
    interpreter.unmount();
  });

  it("stops emitting after unmount", () => {
    const interpreter = doubleTapInterpreter()(element);
    const events: InterpreterEvent[] = [];
    interpreter.subscribe((e) => events.push(e));
    interpreter.unmount();

    element.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 100, clientY: 100, bubbles: true }),
    );

    expect(events).toHaveLength(0);
  });
});
