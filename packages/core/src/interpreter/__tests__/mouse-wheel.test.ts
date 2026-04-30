import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InterpreterEvent } from "../../types.js";
import { mouseWheelInterpreter } from "../mouse-wheel.js";

describe("mouseWheelInterpreter", () => {
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

  it("emits zoom-in motion on negative deltaY", () => {
    const interpreter = mouseWheelInterpreter()(element);
    const motions: InterpreterEvent[] = [];
    interpreter.subscribe((m) => motions.push(m));

    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    expect(motions).toHaveLength(3);
    expect(motions[0].type).toBe("motion");
    if (motions[0].type === "motion") {
      expect(motions[0].dScale).toBeGreaterThan(1); // scrolling up = zoom in
    }
    expect(motions[1].type).toBe("motion");
    if (motions[1].type === "motion") {
      expect(motions[1].dScale).toEqual(1); // scrolling up = zoom in
    }
    expect(motions[2].type).toBe("release");

    interpreter.unmount();
  });

  it("emits zoom-out motion on positive deltaY", () => {
    const interpreter = mouseWheelInterpreter()(element);
    const motions: InterpreterEvent[] = [];
    interpreter.subscribe((m) => motions.push(m as InterpreterEvent));

    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    expect(motions).toHaveLength(3);
    expect(motions[0].type).toBe("motion");
    if (motions[0].type === "motion") {
      expect(motions[0].dScale).toBeLessThan(1); // scrolling down = zoom out
    }
    interpreter.unmount();
  });

  it("sets origin relative to element top-left", () => {
    const interpreter = mouseWheelInterpreter()(element);
    const motions: { originX: number; originY: number }[] = [];
    interpreter.subscribe((m) =>
      motions.push(m as { originX: number; originY: number }),
    );

    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 50,
        clientY: 80,
        bubbles: true,
      }),
    );

    expect(motions[0].originX).toBe(50); // clientX - rect.left (0)
    expect(motions[0].originY).toBe(80); // clientY - rect.top (0)

    interpreter.unmount();
  });
});
