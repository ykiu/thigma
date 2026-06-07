import { describe, it, expect, vi, beforeEach } from "vitest";
import { touchInterpreter } from "../touch.js";

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

function makeTouchEvent(type: string, touches: Touch[]): TouchEvent {
  return new TouchEvent(type, {
    touches,
    changedTouches: touches,
    bubbles: true,
    cancelable: true,
  });
}

describe("touchInterpreter", () => {
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

  it("emits slop on first single-touch move", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(
      makeTouchEvent("touchmove", [makeTouch(0, 110, 120)]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "slop",
      dx: 10,
      dy: 20,
      dScale: 1,
    });
    expect(typeof (events[0] as { timestamp: unknown }).timestamp).toBe(
      "number",
    );

    interpreter.unmount();
  });

  it("emits motion (not slop) on subsequent touchmoves", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(
      makeTouchEvent("touchmove", [makeTouch(0, 110, 120)]),
    );
    element.dispatchEvent(
      makeTouchEvent("touchmove", [makeTouch(0, 115, 125)]),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "slop" });
    expect(events[1]).toMatchObject({ type: "motion", dx: 5, dy: 5 });

    interpreter.unmount();
  });

  it("emits release when touchend fires before any touchmove", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(makeTouchEvent("touchend", []));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "release" });

    interpreter.unmount();
  });

  it("emits release when touchcancel fires before any touchmove", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(makeTouchEvent("touchcancel", []));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "release" });

    interpreter.unmount();
  });

  it("second touchstart during pending transitions to multi_touch (next move emits motion)", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 50, 100)]),
    );
    // Second finger added before any touchmove
    element.dispatchEvent(
      makeTouchEvent("touchstart", [
        makeTouch(0, 50, 100),
        makeTouch(1, 150, 100),
      ]),
    );
    // First touchmove with 2 fingers — should emit motion, not slop
    element.dispatchEvent(
      makeTouchEvent("touchmove", [
        makeTouch(0, 50, 100),
        makeTouch(1, 200, 100),
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "motion" });

    interpreter.unmount();
  });

  it("emits pinch motion on two-touch gesture (simultaneous touchstart)", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    // Two fingers placed simultaneously (e.g. mobile Safari)
    element.dispatchEvent(
      makeTouchEvent("touchstart", [
        makeTouch(0, 50, 100),
        makeTouch(1, 150, 100),
      ]),
    );
    // Move them 200px apart (zoom in 2x)
    element.dispatchEvent(
      makeTouchEvent("touchmove", [
        makeTouch(0, 0, 100),
        makeTouch(1, 200, 100),
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "motion" });
    const e = events[0] as { dScale: number };
    expect(e.dScale).toBeCloseTo(2, 5);

    interpreter.unmount();
  });

  it("emits release event on touchend after motion", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(
      makeTouchEvent("touchmove", [makeTouch(0, 110, 120)]),
    );
    element.dispatchEvent(makeTouchEvent("touchend", []));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "slop" });
    expect(events[1]).toMatchObject({ type: "release" });

    interpreter.unmount();
  });

  it("stops emitting after unmount", () => {
    const interpreter = touchInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));
    interpreter.unmount();

    element.dispatchEvent(
      makeTouchEvent("touchstart", [makeTouch(0, 100, 100)]),
    );
    element.dispatchEvent(
      makeTouchEvent("touchmove", [makeTouch(0, 110, 120)]),
    );

    expect(events).toHaveLength(0);
  });
});
