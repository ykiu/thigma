import type { Renderer, MountedRenderer, Store } from "../types.js";
import type { State } from "../model/simple.js";

export function createRenderer(): Renderer<State> {
  return (element: HTMLElement | SVGElement, store: Store<State>): MountedRenderer => {
    const el = element;

    const unsubscribe = store.subscribe(({ transformX, transformY, scale }) => {
      el.style.transform = `translate(${transformX}px, ${transformY}px) scale(${scale})`;
      el.style.transformOrigin = "0 0";
    });

    return {
      unmount() {
        unsubscribe();
      },
    };
  };
}
