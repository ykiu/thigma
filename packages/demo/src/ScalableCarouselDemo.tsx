import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  touchInterpreter,
  mouseDragInterpreter,
  mouseWheelInterpreter,
  doubleTapInterpreter,
} from "@mimosa/core";
import { ScalableCarouselContainer, ScalableCarouselItem } from "@mimosa/react";

const ITEM_WIDTH = 400;
const ITEM_HEIGHT = 500;

const INITIAL_ITEMS = [
  { id: "photo-1", photoId: "10" },
  { id: "photo-2", photoId: "20" },
  { id: "photo-3", photoId: "30" },
  { id: "photo-4", photoId: "40" },
  { id: "photo-5", photoId: "50" },
];

const interpreters = [
  touchInterpreter(),
  mouseDragInterpreter(),
  mouseWheelInterpreter(),
  doubleTapInterpreter(),
];

export function ScalableCarouselDemo() {
  const [items, setItems] = useState(INITIAL_ITEMS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const nextItemIdRef = useRef(INITIAL_ITEMS.length);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const gridImgRefs = useRef(new Map<string, HTMLImageElement>());
  const carouselImgRefs = useRef(new Map<string, HTMLImageElement>());

  function openModal(index: number) {
    const { id } = items[index];
    const gridImg = gridImgRefs.current.get(id);
    const carouselImg = carouselImgRefs.current.get(id);

    if (!document.startViewTransition) {
      setSelectedIndex(index);
      dialogRef.current?.showModal();
      return;
    }

    gridImg?.style.setProperty("view-transition-name", "selected-photo");
    const transition = document.startViewTransition(() => {
      flushSync(() => setSelectedIndex(index));
      gridImg?.style.removeProperty("view-transition-name");
      dialogRef.current?.showModal();
      carouselImg?.style.setProperty("view-transition-name", "selected-photo");
    });
    transition.finished.then(() => {
      carouselImg?.style.removeProperty("view-transition-name");
    });
  }

  function closeModal() {
    const { id } = items[selectedIndex];
    const gridImg = gridImgRefs.current.get(id);
    const carouselImg = carouselImgRefs.current.get(id);

    if (!document.startViewTransition) {
      dialogRef.current?.close();
      return;
    }
    carouselImg?.style.setProperty("view-transition-name", "selected-photo");
    const transition = document.startViewTransition(() => {
      dialogRef.current?.close();
      carouselImg?.style.removeProperty("view-transition-name");
      gridImg?.style.setProperty("view-transition-name", "selected-photo");
    });
    transition.finished.then(() => {
      gridImg?.style.removeProperty("view-transition-name");
    });
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) closeModal();
  }

  function addItemAt(index: number) {
    const n = nextItemIdRef.current++;
    const newItem = {
      id: `photo-added-${n}`,
      photoId: String(Math.floor(Math.random() * 900) + 1),
    };
    setItems((prev) => [
      ...prev.slice(0, index),
      newItem,
      ...prev.slice(index),
    ]);
    setSelectedIndex(index);
  }

  function removeItemAt(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(Math.max(0, Math.min(index, items.length - 2)));
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-900 p-4">
      <style>
        {
          `
          ::view-transition-group(selected-photo) {
            animation-duration: 5000ms;
            animation-timing-function: ease-out;
          }
          `
        }
      </style>
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ id, photoId }, index) => (
          <button
            key={id}
            type="button"
            className="aspect-square overflow-hidden rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => openModal(index)}
          >
            <img
              ref={(el) => {
                if (el) gridImgRefs.current.set(id, el);
                else gridImgRefs.current.delete(id);
              }}
              src={`https://picsum.photos/id/${photoId}/300/300`}
              alt={id}
              draggable={false}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: <dialog> natively closes on Escape */}
      <dialog
        ref={dialogRef}
        className="bg-gray-900 p-0 max-w-none max-h-none w-screen h-screen backdrop:bg-black/60"
        onClick={handleBackdropClick}
      >
        <div className="flex flex-col h-full">
          <div className="flex justify-end px-4 py-2 shrink-0">
            <button
              type="button"
              className="text-gray-400 hover:text-white text-2xl leading-none"
              onClick={closeModal}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center overflow-hidden">
            <ScalableCarouselContainer
              itemWidth={ITEM_WIDTH}
              itemHeight={ITEM_HEIGHT}
              selectedIndex={selectedIndex}
            >
              {items.map(({ id, photoId }) => (
                <ScalableCarouselItem
                  key={id}
                  id={id}
                  interpreters={interpreters}
                >
                  <img
                    ref={(el) => {
                      if (el) carouselImgRefs.current.set(id, el);
                      else carouselImgRefs.current.delete(id);
                    }}
                    src={`https://picsum.photos/id/${photoId}/${ITEM_WIDTH}/${ITEM_HEIGHT}`}
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
          </div>

          <div className="flex items-center justify-center gap-4 text-sm py-2 shrink-0">
            {items.length === 0 ? (
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
                    Item {selectedIndex + 1} of {items.length}
                  </span>
                  <button
                    type="button"
                    className="px-2 py-1 rounded hover:text-white disabled:opacity-30"
                    disabled={selectedIndex === items.length - 1}
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
      </dialog>
    </div>
  );
}
