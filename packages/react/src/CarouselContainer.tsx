import { useEffect, useRef, type ReactNode } from "react";
import {
  createStore,
  createRenderer,
  createModel,
  type Interpreter,
  type TransformConfig,
} from "@mimosa/core";

type Props = {
  children?: ReactNode;
  itemCount: number;
  itemWidth: number;
  className?: string;
  // Frozen at mount. To swap interpreters, remount via a key change.
  interpreters: Interpreter[];
  // snapTarget in modelOptions overrides the default page-snap behaviour.
  modelOptions?: TransformConfig;
};

export function CarouselContainer({
  children,
  itemCount,
  itemWidth,
  className,
  interpreters,
  modelOptions,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const interpretersRef = useRef(interpreters);
  const modelOptionsRef = useRef(modelOptions);
  modelOptionsRef.current = modelOptions;

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const snapX = (x: number) => {
      const index = Math.round(-x / itemWidth);
      const clamped = Math.max(0, Math.min(itemCount - 1, index));
      return -clamped * itemWidth;
    };

    const mounted = interpretersRef.current.map((interp) => interp(container));
    const store = createStore(
      createModel({
        snapTarget: ({ transform: { x, y, scale } }) => ({
          x: snapX(x),
          y,
          scale,
        }),
        ...modelOptionsRef.current,
      }),
    );
    const stops = mounted.map((m) => m.subscribe((e) => store.dispatch(e)));
    const renderer = createRenderer()(content, store);

    return () => {
      renderer.unmount();
      for (const stop of stops) stop();
      store.unmount();
      for (const m of mounted) m.unmount();
    };
  }, [itemCount, itemWidth]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden", touchAction: "none", cursor: "grab" }}
    >
      <div
        ref={contentRef}
        style={{ display: "flex", width: itemCount * itemWidth }}
      >
        {children}
      </div>
    </div>
  );
}
