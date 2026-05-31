import {
  touchInterpreter,
  mouseDragInterpreter,
  mouseWheelInterpreter,
} from "@mimosa/core";
import { PinchPanContainer } from "@mimosa/react";

const IMAGE_URL = "https://picsum.photos/id/599/400/300";

const interpreters = [
  touchInterpreter(),
  mouseDragInterpreter(),
  mouseWheelInterpreter(),
];

export function PinchPanDemo() {
  return (
    <PinchPanContainer className="flex-1 w-full" interpreters={interpreters}>
      <img
        src={IMAGE_URL}
        alt="demo"
        draggable={false}
        style={{ display: "block", maxWidth: "none", userSelect: "none" }}
      />
    </PinchPanContainer>
  );
}
