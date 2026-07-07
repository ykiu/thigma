import { useEffect, useRef, type ReactNode } from "react";
import {
  createStore,
  createRenderer,
  createModel,
  type Interpreter,
  type TransformConfig,
} from "@thigma/core";

type Props = {
  children?: ReactNode;
  className?: string;
  // Frozen at mount. To swap interpreters, remount via a key change.
  interpreters: Interpreter[];
  modelOptions?: TransformConfig;
};

export function PinchPanContainer({
  children,
  className,
  interpreters,
  modelOptions,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const interpretersRef = useRef(interpreters);
  const modelOptionsRef = useRef(modelOptions);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const mounted = interpretersRef.current.map((interp) => interp(container));
    const store = createStore(createModel(modelOptionsRef.current));
    const stops = mounted.map((m) => m.subscribe((e) => store.dispatch(e)));
    const renderer = createRenderer()(content, store);

    return () => {
      renderer.unmount();
      for (const stop of stops) stop();
      store.unmount();
      for (const m of mounted) m.unmount();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden", touchAction: "none", cursor: "grab" }}
    >
      <div ref={contentRef} style={{ display: "inline-block" }}>
        {children}
      </div>
    </div>
  );
}
