import { useRef, useState } from "react";
import {
  touchInterpreter,
  mouseDragInterpreter,
  mouseWheelInterpreter,
  doubleTapInterpreter,
} from "@mimosa/core";
import {
  PinchPanContainer,
  CarouselContainer,
  ScalableCarouselContainer,
  ScalableCarouselItem,
} from "@mimosa/react";

const IMAGE_URL = "https://picsum.photos/id/599/400/300";

const CAROUSEL_ITEMS = [
  { label: "Item 1", bg: "bg-indigo-600" },
  { label: "Item 2", bg: "bg-emerald-600" },
  { label: "Item 3", bg: "bg-rose-600" },
  { label: "Item 4", bg: "bg-amber-500" },
  { label: "Item 5", bg: "bg-violet-600" },
];

const SCALABLE_CAROUSEL_ITEM_WIDTH = 400;
const SCALABLE_CAROUSEL_ITEM_HEIGHT = 500;

const SCALABLE_CAROUSEL_ITEMS = [
  { id: "photo-1", photoId: "10" },
  { id: "photo-2", photoId: "20" },
  { id: "photo-3", photoId: "30" },
  { id: "photo-4", photoId: "40" },
  { id: "photo-5", photoId: "50" },
];

const pinchPanInterpreters = [
  touchInterpreter(),
  mouseDragInterpreter(),
  mouseWheelInterpreter(),
];

const carouselInterpreters = [touchInterpreter(), mouseDragInterpreter()];

const scalableItemInterpreters = [
  touchInterpreter(),
  mouseDragInterpreter(),
  mouseWheelInterpreter(),
  doubleTapInterpreter(),
];

type Tab = "pinch-pan" | "carousel" | "scalable-carousel";

export function App() {
  const [tab, setTab] = useState<Tab>("pinch-pan");
  const [scalableItems, setScalableItems] = useState(SCALABLE_CAROUSEL_ITEMS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const nextItemIdRef = useRef(SCALABLE_CAROUSEL_ITEMS.length);

  function addItemAt(index: number) {
    const n = nextItemIdRef.current++;
    const newItem = {
      id: `photo-added-${n}`,
      photoId: String(Math.floor(Math.random() * 900) + 1),
    };
    setScalableItems((prev) => [
      ...prev.slice(0, index),
      newItem,
      ...prev.slice(index),
    ]);
    setSelectedIndex(index);
  }

  function removeItemAt(index: number) {
    setScalableItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(Math.max(0, Math.min(index, scalableItems.length - 2)));
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <header className="flex items-center px-4 py-3 bg-gray-800 shadow text-white shrink-0 gap-6">
        <h1 className="text-lg font-semibold tracking-wide">Mimosa Demo</h1>
        <nav className="flex gap-2">
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "pinch-pan" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("pinch-pan")}
          >
            Pinch / Pan
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "carousel" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("carousel")}
          >
            Carousel
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "scalable-carousel" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("scalable-carousel")}
          >
            Scalable Carousel
          </button>
        </nav>
      </header>

      {tab === "pinch-pan" && (
        <PinchPanContainer
          className="flex-1 w-full"
          interpreters={pinchPanInterpreters}
        >
          <img
            src={IMAGE_URL}
            alt="demo"
            draggable={false}
            style={{ display: "block", maxWidth: "none", userSelect: "none" }}
          />
        </PinchPanContainer>
      )}

      {tab === "carousel" && (
        <div className="flex-1 flex flex-col">
          <CarouselContainer
            itemCount={CAROUSEL_ITEMS.length}
            itemWidth={400}
            className="flex-1"
            interpreters={carouselInterpreters}
          >
            {CAROUSEL_ITEMS.map(({ label, bg }) => (
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
      )}

      {tab === "scalable-carousel" && (
        <div className="flex-1 flex flex-col justify-center bg-gray-900">
          <ScalableCarouselContainer
            itemWidth={SCALABLE_CAROUSEL_ITEM_WIDTH}
            itemHeight={SCALABLE_CAROUSEL_ITEM_HEIGHT}
          >
            {scalableItems.map(({ id, photoId }) => (
              <ScalableCarouselItem
                key={id}
                id={id}
                interpreters={scalableItemInterpreters}
              >
                <img
                  src={`https://picsum.photos/id/${photoId}/${SCALABLE_CAROUSEL_ITEM_WIDTH}/${SCALABLE_CAROUSEL_ITEM_HEIGHT}`}
                  alt={id}
                  draggable={false}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    userSelect: "none",
                  }}
                />
              </ScalableCarouselItem>
            ))}
          </ScalableCarouselContainer>
          <div className="flex items-center justify-center gap-4 text-sm py-2">
            {scalableItems.length === 0 ? (
              <button
                type="button"
                className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                onClick={() => addItemAt(0)}
              >
                Add Item
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 text-gray-400">
                  <button
                    type="button"
                    className="px-2 py-1 rounded hover:text-white disabled:opacity-30"
                    disabled={selectedIndex === 0}
                    onClick={() => setSelectedIndex((i) => i - 1)}
                  >
                    ←
                  </button>
                  <span>
                    Item {selectedIndex + 1} of {scalableItems.length}
                  </span>
                  <button
                    type="button"
                    className="px-2 py-1 rounded hover:text-white disabled:opacity-30"
                    disabled={selectedIndex === scalableItems.length - 1}
                    onClick={() => setSelectedIndex((i) => i + 1)}
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                  onClick={() => addItemAt(selectedIndex)}
                >
                  Add Before
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                  onClick={() => addItemAt(selectedIndex + 1)}
                >
                  Add After
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-rose-700 text-white hover:bg-rose-600"
                  onClick={() => removeItemAt(selectedIndex)}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
