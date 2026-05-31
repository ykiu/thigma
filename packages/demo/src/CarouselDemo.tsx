import { touchInterpreter, mouseDragInterpreter } from "@mimosa/core";
import { CarouselContainer } from "@mimosa/react";

const ITEMS = [
  { label: "Item 1", bg: "bg-indigo-600" },
  { label: "Item 2", bg: "bg-emerald-600" },
  { label: "Item 3", bg: "bg-rose-600" },
  { label: "Item 4", bg: "bg-amber-500" },
  { label: "Item 5", bg: "bg-violet-600" },
];

const interpreters = [touchInterpreter(), mouseDragInterpreter()];

export function CarouselDemo() {
  return (
    <div className="flex-1 flex flex-col">
      <CarouselContainer
        itemCount={ITEMS.length}
        itemWidth={400}
        className="flex-1"
        interpreters={interpreters}
      >
        {ITEMS.map(({ label, bg }) => (
          <div
            key={label}
            className={`${bg} flex items-center justify-center text-white text-2xl font-bold shrink-0`}
            style={{ width: 400, height: "100%" }}
          >
            {label}
          </div>
        ))}
      </CarouselContainer>
      <p className="text-center text-gray-500 text-sm py-2">
        Drag or swipe to navigate · Snaps to each item
      </p>
    </div>
  );
}
