import type React from "react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  touchInterpreter,
  mouseDragInterpreter,
  mouseWheelInterpreter,
  doubleTapInterpreter,
} from "@mimosa/core";
import { ScalableCarouselContainer, ScalableCarouselItem } from "@mimosa/react";

const ITEM_WIDTH = '100%';
const ITEM_HEIGHT = '100%';
const ITEM_SOURCE_WIDTH = 300;
const ITEM_SOURCE_HEIGHT = 400;

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
  const [selectedItemId, setSelectedItemId] = useState(INITIAL_ITEMS[0].id);
  const nextItemIdRef = useRef(INITIAL_ITEMS.length);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const gridImgRefs = useRef(new Map<string, HTMLImageElement>());
  const carouselImgRefs = useRef(new Map<string, HTMLImageElement>());

  const selectedIndex = items.findIndex((i) => i.id === selectedItemId);

  function openModal(index: number) {
    const { id } = items[index];
    const gridImg = gridImgRefs.current.get(id);
    const carouselImg = carouselImgRefs.current.get(id);

    dialogRef.current?.style.setProperty("--dismiss-progress", "0");

    if (!document.startViewTransition) {
      setSelectedItemId(id);
      dialogRef.current?.showModal();
      return;
    }

    gridImg?.style.setProperty("view-transition-name", "selected-photo");
    const transition = document.startViewTransition(() => {
      flushSync(() => setSelectedItemId(id));
      gridImg?.style.removeProperty("view-transition-name");
      dialogRef.current?.showModal();
      carouselImg?.style.setProperty("view-transition-name", "selected-photo");
    });
    transition.finished.finally(() => {
      carouselImg?.style.removeProperty("view-transition-name");
    });
  }

  function closeModal() {
    const gridImg = gridImgRefs.current.get(selectedItemId);
    const carouselImg = carouselImgRefs.current.get(selectedItemId);

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
    transition.finished.finally(() => {
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
    setSelectedItemId(newItem.id);
  }

  function removeItemAt(index: number) {
    const newItems = items.filter((_, i) => i !== index);
    const newIndex = Math.max(0, Math.min(index, newItems.length - 1));
    setItems(newItems);
    setSelectedItemId(newItems[newIndex]?.id ?? "");
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-900 p-4">
      <style>
        {`
          ::view-transition-group(selected-photo) {
            animation-duration: 400ms;
            animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
          }
          ::view-transition-image-pair(selected-photo) {
            overflow: hidden;
            position: relative;
            width: 100%;
            height: 100%;
            display: block;
          }
          ::view-transition-old(selected-photo),
          ::view-transition-new(selected-photo) {
            opacity: 1 !important;
            mix-blend-mode: normal !important;

            /* Place the image in the center of the container and make it cover the area, similar to object-fit: cover */
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 100%;
            height: 100%;

            object-fit: cover;
          }
          dialog::backdrop {
            background: rgba(0, 0, 0, calc(0.6 * (1 - var(--dismiss-progress, 0))));
          }
          `}
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
        className="bg-gray-900 p-0 max-w-none max-h-none w-screen h-screen"
        style={
          {
            "--dismiss-progress": "0",
          } as React.CSSProperties
        }
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

          <div className="flex-1 flex flex-col justify-center overflow-hidden px">
            <ScalableCarouselContainer
              className="h-full"
              itemWidth={ITEM_WIDTH}
              itemHeight={ITEM_HEIGHT}
              selectedItemId={selectedItemId}
              onSelectedItemIdChange={setSelectedItemId}
              onDismiss={closeModal}
              onDismissProgress={(progress) => {
                dialogRef.current?.style.setProperty(
                  "--dismiss-progress",
                  String(progress),
                );
              }}
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
                    src={`https://picsum.photos/id/${photoId}/${ITEM_SOURCE_WIDTH}/${ITEM_SOURCE_HEIGHT}`}
                    alt={id}
                    draggable={false}
                    className="block w-full h-full object-contain select-none"
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
                    onClick={() =>
                      setSelectedItemId(items[selectedIndex - 1].id)
                    }
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
                    onClick={() =>
                      setSelectedItemId(items[selectedIndex + 1].id)
                    }
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
