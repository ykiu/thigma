import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type CarouselContextValue = {
  store: Store<CarouselPublicState, CarouselAction>;
  itemWidth: number;
  itemHeight: number;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

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
};

export function ScalableCarouselItem({
  id,
  children,
  interpreters,
}: ScalableCarouselItemProps) {
  const ctx = useContext(CarouselContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const interpretersRef = useRef(interpreters);

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
    return ctx.store.subscribe((state) => {
      const el = contentRef.current;
      const itemState = state.items[id];
      if (el && itemState) {
        el.style.transform = `translate(${itemState.transformX}px, ${itemState.transformY}px) scale(${itemState.scale})`;
        el.style.transformOrigin = "0 0";
      }
    });
  }, [ctx, id]);

  return (
    <div
      ref={viewportRef}
      style={{
        width: ctx?.itemWidth ?? 0,
        height: ctx?.itemHeight ?? 0,
        flexShrink: 0,
        overflow: "hidden",
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
  itemWidth: number;
  itemHeight: number;
  selectedItemId?: string;
  onSelectedItemIdChange?: (itemId: string) => void;
  className?: string;
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

export function ScalableCarouselContainer({
  children,
  itemWidth,
  itemHeight,
  selectedItemId,
  onSelectedItemIdChange,
  className,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [store, setStore] = useState<Store<
    CarouselPublicState,
    CarouselAction
  > | null>(null);

  const itemIds = deriveItemIds(children);
  const itemIdsRef = useRef<readonly string[]>(itemIds);
  itemIdsRef.current = itemIds;

  const itemWidthRef = useRef(itemWidth);
  itemWidthRef.current = itemWidth;

  const itemHeightRef = useRef(itemHeight);
  itemHeightRef.current = itemHeight;

  const onSelectedItemIdChangeRef = useRef(onSelectedItemIdChange);
  onSelectedItemIdChangeRef.current = onSelectedItemIdChange;

  const itemIdsKey = itemIds.join(",");

  useEffect(() => {
    const s = createStore(
      createCarouselModel({
        itemWidth: itemWidthRef.current,
        itemHeight: itemHeightRef.current,
        itemIds: itemIdsRef.current,
      }),
    );

    setStore(s);

    const unsubscribe = s.subscribe((state, prevState) => {
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
    });

    return () => {
      unsubscribe();
      s.unmount();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: itemIdsKey is an intentional trigger dep for itemIdsRef.current
  useEffect(() => {
    if (!store) return;
    store.dispatch({
      type: "set-config",
      config: {
        itemWidth: itemWidthRef.current,
        itemHeight: itemHeightRef.current,
        itemIds: itemIdsRef.current,
      },
    });
  }, [store, itemWidth, itemHeight, itemIdsKey]);

  useLayoutEffect(() => {
    if (selectedItemId === undefined || !store) return;
    const index = itemIdsRef.current.indexOf(selectedItemId);
    if (index === -1) return;
    store.dispatch({ type: "navigate-to", index });
    store.flush();
  }, [store, selectedItemId]);

  const contextValue = useMemo(
    () => (store ? { store, itemWidth, itemHeight } : null),
    [store, itemWidth, itemHeight],
  );

  return (
    <div
      className={className}
      style={{ overflow: "hidden", touchAction: "none" }}
    >
      <div ref={stripRef} style={{ display: "flex" }}>
        <CarouselContext.Provider value={contextValue}>
          {children}
        </CarouselContext.Provider>
      </div>
    </div>
  );
}
