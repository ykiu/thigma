import {
  touchInterpreter,
  mouseDragInterpreter,
  doubleTapInterpreter,
} from "@mimosa/core";
import { ScalableCarouselContainer, ScalableCarouselItem } from "@mimosa/react";

const ITEM_WIDTH = 400;
const ITEM_HEIGHT = 400;

const ITEMS = [
  { id: "item-1", label: "Item 1", bg: "bg-indigo-600" },
  { id: "item-2", label: "Item 2", bg: "bg-emerald-600" },
  { id: "item-3", label: "Item 3", bg: "bg-rose-600" },
  { id: "item-4", label: "Item 4", bg: "bg-amber-500" },
  { id: "item-5", label: "Item 5", bg: "bg-violet-600" },
];

const interpreters = [
  touchInterpreter(),
  mouseDragInterpreter(),
  doubleTapInterpreter(),
];

export function CarouselDemo() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <ScalableCarouselContainer itemWidth={ITEM_WIDTH} itemHeight={ITEM_HEIGHT}>
        {ITEMS.map(({ id, label, bg }) => (
          <ScalableCarouselItem key={id} id={id} interpreters={interpreters}>
            <div
              className={`${bg} flex items-center justify-center text-white text-2xl font-bold`}
              style={{ width: ITEM_WIDTH, height: ITEM_HEIGHT }}
            >
              {label}
            </div>
          </ScalableCarouselItem>
        ))}
      </ScalableCarouselContainer>
      <p className="text-center text-gray-500 text-sm py-2">
        Drag or swipe to navigate · Snaps to each item · Double-tap to zoom
      </p>
    </div>
  );
}
