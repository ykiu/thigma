import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  touchInterpreter,
  mouseDragInterpreter,
  createStore,
  createCarouselModel,
  type MountedStore,
  type MountedInterpreter,
  type InterpreterEvent,
  mouseWheelInterpreter,
  doubleTapInterpreter,
  type CarouselAction,
  type CarouselPublicState,
} from "@mimosa/core";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type CarouselContextValue = {
  store: MountedStore<CarouselPublicState, CarouselAction>;
  itemWidth: number;
  itemHeight: number;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

// ---------------------------------------------------------------------------
// withItemId — tags all events from an interpreter with an item ID
// ---------------------------------------------------------------------------

function withItemId(
  interp: MountedInterpreter,
  itemId: string,
): MountedInterpreter {
  return {
    subscribe(cb) {
      return interp.subscribe((event: InterpreterEvent) =>
        cb({ ...event, itemId }),
      );
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
};

export function ScalableCarouselItem({
  id,
  children,
}: ScalableCarouselItemProps) {
  const ctx = useContext(CarouselContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Mount interpreters for this item.
  useEffect(() => {
    if (!ctx) return;
    const { store } = ctx;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const interpreters: MountedInterpreter[] = [
      withItemId(touchInterpreter()(viewport), id),
      withItemId(mouseDragInterpreter()(viewport), id),
      withItemId(mouseWheelInterpreter()(viewport), id),
      withItemId(doubleTapInterpreter()(viewport), id),
    ];

    const unmounts = interpreters.map((interp) => store.mount(interp));
    return () => {
      for (const unmount of unmounts) unmount();
      for (const interp of interpreters) interp.unmount();
    };
  }, [ctx, id]);

  // Subscribe to store and apply this item's transform.
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
  className,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [store, setStore] = useState<MountedStore<
    CarouselPublicState,
    CarouselAction
  > | null>(null);

  // Keep a ref to the latest itemIds so effects can read the current value
  // without needing it in their dependency arrays (the array is a new reference
  // every render even when content is unchanged).
  const itemIds = deriveItemIds(children);
  const itemIdsRef = useRef<readonly string[]>(itemIds);
  itemIdsRef.current = itemIds;

  // Stable string key used as a dep to detect actual content changes.
  const itemIdsKey = itemIds.join(",");

  // Create the store once per itemWidth/itemHeight.
  useEffect(() => {
    const s = createStore(
      createCarouselModel({
        itemWidth,
        itemHeight,
        itemIds: itemIdsRef.current,
      }),
    )([]);

    setStore(s);

    const unsubscribe = s.subscribe((state) => {
      if (stripRef.current) {
        stripRef.current.style.transform = `translateX(${state.carouselTranslateX}px)`;
      }
    });

    return () => {
      unsubscribe();
      s.unmount();
      setStore(null);
    };
  }, [itemWidth, itemHeight]);

  // Dispatch set-config whenever the item list changes after the store is ready.
  // itemIdsKey is included as a trigger dep even though itemIdsRef.current is
  // what's read inside — the ref is always current, the key signals the change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemIdsKey is an intentional trigger dep for itemIdsRef.current
  useEffect(() => {
    if (!store) return;
    store.dispatch({
      type: "set-config",
      config: { itemWidth, itemHeight, itemIds: itemIdsRef.current },
    });
  }, [store, itemWidth, itemHeight, itemIdsKey]);

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
