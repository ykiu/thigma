import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createStore,
  createCarouselModel,
  type Store,
  type MountedInterpreter,
  type CarouselAction,
  type CarouselPublicState,
  type Interpreter,
} from "@mimosa/core";

type Dimension = number | `${number}%`;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type CarouselContextValue = {
  store: Store<CarouselPublicState, CarouselAction>;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

// ---------------------------------------------------------------------------
// resolveDimension
// ---------------------------------------------------------------------------

function resolveDimension(dim: Dimension, containerSize: number): number {
  if (typeof dim === "number") return dim;
  const value = (containerSize * parseFloat(dim)) / 100;
  if (!Number.isFinite(value))
    throw new RangeError(`Invalid Dimension: "${dim}"`);
  return value;
}

// ---------------------------------------------------------------------------
// withItemId — tags all events from a mounted interpreter with an item ID
// ---------------------------------------------------------------------------

function withItemId(
  interp: MountedInterpreter,
  itemId: string,
): MountedInterpreter {
  return {
    subscribe(cb) {
      return interp.subscribe((event) => cb({ ...event, itemId }));
    },
    unmount: () => interp.unmount(),
  };
}

// ---------------------------------------------------------------------------
// ScalableCarouselItem
// ---------------------------------------------------------------------------

type ScalableCarouselItemProps = {
  id: string;
  children?: ReactNode;
  // Frozen at mount. To swap interpreters, remount via a key change.
  interpreters: Interpreter[];
  /** Notifies raw scale value whenever this item's published scale changes.
      Fires potentially every frame during pinch/animation; handler must be cheap.
      (During dismiss gesture, values < 1 also flow through.) */
  onScaleChange?: (scale: number) => void;
};

export function ScalableCarouselItem({
  id,
  children,
  interpreters,
  onScaleChange,
}: ScalableCarouselItemProps) {
  const ctx = useContext(CarouselContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const interpretersRef = useRef(interpreters);
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;

  useEffect(() => {
    if (!ctx) return;
    const { store } = ctx;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const mounted: MountedInterpreter[] = interpretersRef.current.map(
      (interp) => withItemId(interp(viewport), id),
    );
    const stops = mounted.map((m) => m.subscribe((e) => store.dispatch(e)));

    return () => {
      for (const stop of stops) stop();
      for (const m of mounted) m.unmount();
    };
  }, [ctx, id]);

  useEffect(() => {
    if (!ctx) return;
    return ctx.store.subscribe((state, prevState) => {
      const el = contentRef.current;
      const itemState = state.items[id];
      if (el && itemState) {
        el.style.transform = `translate(${itemState.transformX}px, ${itemState.transformY}px) scale(${itemState.scale})`;
        el.style.transformOrigin = "0 0";
      }
      if (itemState && itemState.scale !== prevState.items[id]?.scale) {
        onScaleChangeRef.current?.(itemState.scale);
      }
    });
  }, [ctx, id]);

  return (
    <div
      ref={viewportRef}
      style={{
        width: "var(--_carousel-item-width, 0px)",
        height: "var(--_carousel-item-height, 0px)",
        flexShrink: 0,
        cursor: "grab",
      }}
    >
      <div ref={contentRef} style={{ width: "100%", height: "100%" }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScalableCarouselContainer
// ---------------------------------------------------------------------------

type Props = {
  children?: ReactNode;
  itemWidth: Dimension;
  itemHeight: Dimension;
  selectedItemId?: string;
  onSelectedItemIdChange?: (itemId: string) => void;
  onDismiss?: () => void;
  onDismissProgress?: (progress: number) => void;
  className?: string;
  style?: React.CSSProperties;
};

export type ScalableCarouselContainerHandle = {
  /**
   * Animates the carousel to the item `delta` positions away (negative =
   * backward), clamped to the ends. No-op during an active gesture.
   */
  navigateBy: (delta: number) => void;
};

function deriveItemIds(children: ReactNode): readonly string[] {
  return Children.toArray(children)
    .filter(
      (child): child is React.ReactElement<ScalableCarouselItemProps> =>
        isValidElement(child) &&
        (child.type as unknown) === ScalableCarouselItem,
    )
    .map((child) => child.props.id);
}

export const ScalableCarouselContainer = forwardRef<
  ScalableCarouselContainerHandle,
  Props
>(function ScalableCarouselContainer(
  {
    children,
    itemWidth,
    itemHeight,
    selectedItemId,
    onSelectedItemIdChange,
    onDismiss,
    onDismissProgress,
    className,
    style,
  },
  ref,
) {
  const stripRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerPxRef = useRef<{ width: number; height: number } | null>(null);
  const storeRef = useRef<Store<CarouselPublicState, CarouselAction> | null>(
    null,
  );
  const [store, setStore] = useState<Store<
    CarouselPublicState,
    CarouselAction
  > | null>(null);

  const itemIds = deriveItemIds(children);
  const itemIdsRef = useRef<readonly string[]>(itemIds);
  itemIdsRef.current = itemIds;

  const itemWidthRef = useRef<number>(0);
  const itemHeightRef = useRef<number>(0);
  const itemWidthDimRef = useRef<Dimension>(itemWidth);
  const itemHeightDimRef = useRef<Dimension>(itemHeight);
  itemWidthDimRef.current = itemWidth;
  itemHeightDimRef.current = itemHeight;

  const onSelectedItemIdChangeRef = useRef(onSelectedItemIdChange);
  onSelectedItemIdChangeRef.current = onSelectedItemIdChange;

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const onDismissProgressRef = useRef(onDismissProgress);
  onDismissProgressRef.current = onDismissProgress;

  const itemIdsKey = itemIds.join(",");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let unsubscribeStore: (() => void) | null = null;

    function applyDimensions(
      target: HTMLDivElement,
      containerWidth: number,
      containerHeight: number,
    ) {
      if (containerWidth === 0 || containerHeight === 0) return;

      const w = resolveDimension(itemWidthDimRef.current, containerWidth);
      const h = resolveDimension(itemHeightDimRef.current, containerHeight);
      if (w === 0 || h === 0) return;

      // Stale guard — skip when nothing changed and the store already exists
      if (
        w === itemWidthRef.current &&
        h === itemHeightRef.current &&
        storeRef.current !== null
      )
        return;

      containerPxRef.current = {
        width: containerWidth,
        height: containerHeight,
      };
      itemWidthRef.current = w;
      itemHeightRef.current = h;

      target.style.setProperty("--_carousel-item-width", `${w}px`);
      target.style.setProperty("--_carousel-item-height", `${h}px`);

      if (!storeRef.current) {
        const s = createStore(
          createCarouselModel({
            itemWidth: w,
            itemHeight: h,
            itemIds: itemIdsRef.current,
            dismissible: !!onDismissRef.current,
          }),
        );
        storeRef.current = s;
        unsubscribeStore = s.subscribe((state, prevState) => {
          if (stripRef.current) {
            stripRef.current.style.transform = `translateX(${state.carouselTranslateX}px)`;
          }
          if (state.isCarouselSettled && !prevState.isCarouselSettled) {
            const index = Math.round(
              -state.carouselTranslateX / itemWidthRef.current,
            );
            const clamped = Math.max(
              0,
              Math.min(itemIdsRef.current.length - 1, index),
            );
            const id = itemIdsRef.current[clamped];
            if (id !== undefined) onSelectedItemIdChangeRef.current?.(id);
          }
          if (state.isDismissed && !prevState.isDismissed) {
            onDismissRef.current?.();
            const index = Math.round(
              -state.carouselTranslateX / itemWidthRef.current,
            );
            const clamped = Math.max(
              0,
              Math.min(itemIdsRef.current.length - 1, index),
            );
            s.dispatch({ type: "navigate-to", index: clamped });
          }
          if (state.dismissProgress !== prevState.dismissProgress) {
            onDismissProgressRef.current?.(state.dismissProgress);
          }
        });
        setStore(s);
      } else {
        storeRef.current.dispatch({
          type: "set-config",
          config: {
            itemWidth: w,
            itemHeight: h,
            itemIds: itemIdsRef.current,
            dismissible: !!onDismissRef.current,
          },
        });
      }
    }

    const rect = el.getBoundingClientRect();
    applyDimensions(el, rect.width, rect.height);

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) applyDimensions(el, e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      unsubscribeStore?.();
      storeRef.current?.unmount();
      storeRef.current = null;
      setStore(null);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: itemIdsKey triggers itemIdsRef.current; itemWidth/itemHeight trigger itemWidthDimRef/itemHeightDimRef; storeRef.current intentionally not in deps
  useEffect(() => {
    const s = storeRef.current;
    if (!s) return;
    const c = containerPxRef.current;
    if (!c) return;

    const w = resolveDimension(itemWidthDimRef.current, c.width);
    const h = resolveDimension(itemHeightDimRef.current, c.height);
    if (w === 0 || h === 0) return;

    itemWidthRef.current = w;
    itemHeightRef.current = h;
    containerRef.current?.style.setProperty("--_carousel-item-width", `${w}px`);
    containerRef.current?.style.setProperty(
      "--_carousel-item-height",
      `${h}px`,
    );

    s.dispatch({
      type: "set-config",
      config: {
        itemWidth: w,
        itemHeight: h,
        itemIds: itemIdsRef.current,
        dismissible: !!onDismissRef.current,
      },
    });
  }, [itemWidth, itemHeight, itemIdsKey]);

  useLayoutEffect(() => {
    if (selectedItemId === undefined || !store) return;
    const index = itemIdsRef.current.indexOf(selectedItemId);
    if (index === -1) return;
    store.dispatch({ type: "navigate-to", index });
    store.flush();
  }, [store, selectedItemId]);

  useImperativeHandle(
    ref,
    () => ({
      navigateBy: (delta: number) => {
        storeRef.current?.dispatch({ type: "navigate-by", delta });
      },
    }),
    [],
  );

  const contextValue = useMemo(() => (store ? { store } : null), [store]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ touchAction: "none", ...style }}
    >
      <div ref={stripRef} style={{ display: "flex" }}>
        <CarouselContext.Provider value={contextValue}>
          {children}
        </CarouselContext.Provider>
      </div>
    </div>
  );
});
