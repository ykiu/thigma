# Architecture of the Web Pinch/Pan Library

## Conventions

All transformations in this library are expressed as a combination of transformX, transformY, and scale. The transform-origin for scale is set to the top-left corner of the target element. To make it appear as though scaling is centered on the pinch gesture's midpoint, the library computes appropriate transformX and transformY values based on the pinch origin (the actual scale transform is always applied relative to the top-left corner).

## Common Type Definitions

```typescript
type UnsubscribeFn = () => void;
type UnmountFn = () => void;
type InterpreterCallback<T> = (value: T) => void;
type StateCallback<T> = (state: T, prevState: T) => void;
```

**Reducer** is the core abstraction for state machines in this library. A Reducer is a pure function that takes the current state and an action, and returns the next state. The first call passes `undefined` for state; the reducer must return an initial state in that case.

```typescript
type Reducer<TPrivateState, TAction = StoreAction> = (
  state: TPrivateState | undefined,
  action: TAction,
) => TPrivateState;
```

**Model** is the top-level abstraction that bundles a reducer with a projection function. It encapsulates both the private state machine and the mapping to a public-facing state that consumers observe:

```typescript
interface Model<TPublicState, TPrivateState, TAction = StoreAction> {
  reduce: Reducer<TPrivateState, TAction>;
  publish(state: TPrivateState): TPublicState;
}
```

**InterpreterEvent** is the output of an Interpreter. It is a tagged union that covers gesture movement, the moment the user releases the gesture, and discrete tap gestures. The motion fields (`dx`, `dy`, `dScale`, `originX`, `originY`) are inlined directly into the `motion` and `slop` variants. For pan-only gestures, `dScale` is `1` and `originX/Y` are `0`.

```typescript
type InterpreterEvent =
  | {
      type: 'motion'; itemId?: string; timestamp: number;
      dx: number;      // horizontal translation delta (px)
      dy: number;      // vertical translation delta (px)
      dScale: number;  // multiplicative scale factor (1.0 = no change, 1.1 = 10% zoom in)
      originX: number; // scale origin X, relative to the element's top-left corner (px)
      originY: number; // scale origin Y, relative to the element's top-left corner (px)
    }
  | {
      type: 'slop'; itemId?: string; timestamp: number;
      dx: number; dy: number; dScale: number; originX: number; originY: number;
      pointerX: number; pointerY: number;  // initial touch position relative to element top-left (px)
    }
  | { type: 'release'; itemId?: string }
  | { type: 'toggle-zoom'; itemId?: string; originX: number; originY: number; timestamp: number };
```

The `slop` variant carries the same fields as `motion` and represents the displacement between the initial `touchstart` position and the first `touchmove` position — the distance consumed by the browser's touch slop threshold. Models ignore `slop` (it does not move the element); it is available for gesture-direction detection.

The optional `itemId` field identifies which item within a multi-item container (e.g. a carousel) the gesture targets. It is absent for container-level gestures such as swiping the carousel strip itself.

The `timestamp` on motion events is taken from the originating DOM event (`e.timeStamp`) and is used by the Store to compute accurate time deltas for velocity tracking.

**State** is the output of the Store and represents the current transform applied to the target element. Velocity information is kept as internal Store state and is not exposed.

```typescript
type State = {
  transformX: number; // horizontal translation (px)
  transformY: number; // vertical translation (px)
  scale: number;      // scale factor (1.0 = original size)
};
```

## State Machine Design

All stateful logic in this library is implemented as pure reducer functions. This is a library-wide principle that applies to every module that maintains state.

### State Representation with Tagged Unions

Each stateful component models its internal state as a tagged union, where each variant represents a distinct and valid configuration. With tagged unions, impossible states become inexpressible — the type system enforces invariants with no runtime checks required. The set of valid state transitions also becomes self-documenting: a `touchmove` event received in a `no_touch` state cannot reach the code path that computes a pan motion, because that path pattern-matches on `single_touch`.

### Reducer Pattern

State transitions are implemented as pure reducers. Separating pure transition logic from side effects (event subscription, output event emission) yields two practical benefits:

1. **Testability**: A reducer can be tested as a plain function with no DOM or framework setup — pass a state and an action, assert on the returned state and optional output event.
2. **Traceability**: Every state change originates from a named action, making the flow of data easy to follow and debug.

Side effects are confined to a thin `dispatch()` wrapper that calls `reduce`, updates the stored state, and handles any output event returned by the reducer.

### Reference Equality Contract

To support the Store's pause/resume optimization, all Reducers must follow a **reference equality contract**: when an action causes no state change, return the same object reference rather than a new object with identical values. This allows the Store to detect a settled state with a simple `===` check.

## Module Composition

The library consists of four primary modules:

1. **Interpreter**: Responsible for detecting and processing gestures. Captures user input and identifies gestures such as pinch and pan.
2. **Model**: Contains the state transition logic (reducer) for transformations. Describes how the transform state evolves in response to gestures and animation ticks.
3. **Store**: A generic event loop that wires together Interpreters and a reducer. Drives the animation loop and notifies subscribers on each frame.
4. **Renderer**: Responsible for rendering the target element. Reads from the Store and applies transformations to the actual DOM element.

## Interpreter Module

The role of this module is to abstract user input events such as TouchEvent and MouseEvent, and interpret them as meaningful actions such as zoom or pan. The module provides a state machine that takes these events as input.

The Interpreter emits detected gesture information as **InterpreterEvent**. Motion events express transformations as relative changes from the previous state. A release event is emitted when the user lifts all fingers or releases the mouse button. Events are delivered to the outside world via a callback provided to the Interpreter.

Key interfaces and functions:

```typescript
type Interpreter = (element: Element) => MountedInterpreter;
type MountedInterpreter = {
  subscribe: (cb: InterpreterCallback<InterpreterEvent>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function touchInterpreter(): Interpreter;
declare function mouseDragInterpreter(): Interpreter;
declare function mouseWheelInterpreter(): Interpreter;
declare function doubleTapInterpreter(): Interpreter;
```

Implementation details:

- When called, an Interpreter begins listening to the target element's events via addEventListener. Listening stops when UnmountFn is called.
- **touchInterpreter**: A factory function for an interpreter that handles touch events. Tracks multiple touch points and identifies gestures such as pinch and pan.
- **mouseDragInterpreter**: A factory function for an interpreter that handles mouse drag events. Tracks mouse movement and identifies pan gestures.
- **mouseWheelInterpreter**: A factory function for an interpreter that handles mouse wheel events. Tracks wheel rotation and identifies zoom gestures.
- **doubleTapInterpreter**: A factory function for an interpreter that detects double-tap gestures. Handles the native `dblclick` event for mouse and manually tracks two consecutive single-finger touches within a time and distance threshold for touch. Emits `toggle-zoom`.

### State Representation

Each stateful interpreter models its internal state as a tagged union following the library-wide [State Machine Design](#state-machine-design) principles:

- `touchInterpreter`: `no_touch | pending | single_touch | multi_touch`
- `mouseDragInterpreter`: `idle | dragging`
- `doubleTapInterpreter`: `idle | awaiting_second_tap`

For example, a `single_touch` state necessarily carries exactly one touch point, and a `multi_touch` state necessarily carries exactly two. The `pending` state is entered when the first finger lands (`no_touch → pending`) and holds that initial touch point. The first `touchmove` from `pending` emits a `slop` event and transitions to `single_touch`; a second finger added during `pending` transitions directly to `multi_touch`. `touchInterpreter` can transition `no_touch → multi_touch` directly when the browser fires a `touchstart` with two simultaneous touches (e.g. mobile Safari).

Each action corresponds to a DOM event. Side effects are confined to the thin `dispatch()` wrapper inside each interpreter factory, which calls `reduce`, updates the stored state, and emits the `InterpreterEvent` if one was returned.

## Model Module

The Model module contains the pure state transition logic for transformations, expressed as the Model interface. Following the library-wide [State Machine Design](#state-machine-design) principles, it defines a reducer that describes how the transform state changes in response to gestures and animation ticks. Separating this logic from the Store makes it independently testable and replaceable.

### Pre-Built Models

The Model module provides two factory functions for common use cases.

#### Single-Item Transform Model (`createModel`)

A Model for single-item pinch-to-zoom and pan.

```typescript
declare function createModel(config?: TransformConfig): Model<State, TransformPrivateState, TransformAction>;

type TransformConfig = {
  elementWidth?: number;
  elementHeight?: number;
  /**
   * Constrains the element so its edges stay within the given coordinates.
   * Also enforces a minimum scale so the element can always satisfy these constraints.
   */
  bounds?: { left?: number; right?: number; top?: number; bottom?: number };
  snapTarget?: (state: { transform: Transform; velocity: TransformVelocity }) => TransformSnapTarget | null;
  /** Scale factor to apply when zooming in via double-tap. Defaults to 2. */
  toggleZoomScale?: number;
};
```

The private state is a tagged union:

```typescript
type TransformPrivateState =
  | { type: "tracking"; transform: Transform; velocity: TransformVelocity; lastUpdatedAt: number; origin: { x: number; y: number } }
  | { type: "inertia";  transform: Transform; velocity: TransformVelocity; lastUpdatedAt: number; origin: { x: number; y: number } }
  | { type: "snapping"; transform: Transform; lastUpdatedAt: number; target: TransformSnapTarget }
  | { type: "settled";  transform: Transform; lastUpdatedAt: number };
```

- **tracking** — the user is actively gesturing.
- **inertia** — the user released and the element is coasting.
- **snapping** — the element is spring-interpolating toward a snap target.
- **settled** — no motion; the animation loop is paused.

#### Multi-Item Carousel Model (`createCarouselModel`)

A Model for multi-item carousels that support per-item pinch-to-zoom. Its action type extends `TransformAction` with a `set-config` action that allows changing the item list at runtime:

```typescript
declare function createCarouselModel(config: CarouselConfig): Model<CarouselPublicState, CarouselPrivateState, CarouselAction>;

type CarouselConfig = {
  itemWidth: number;            // item container width (px)
  itemHeight: number;           // item container height (px)
  itemIds: readonly string[];   // ordered list of item identifiers
  dismissible?: boolean;        // default false; gates slop → dismissing transition
};

type CarouselAction =
  | TransformAction
  | { type: "set-config"; config: CarouselConfig }
  | { type: "navigate-to"; index: number };
```

Dispatching `set-config` updates the item list while preserving carousel animation state. The carousel strip stays anchored to the item the gesture was heading toward; deleted items lose their transform state; new items start at the neutral transform. If the active item (currently being panned/zoomed) is deleted, the model transitions immediately to the `free` state.

Dispatching `navigate-to` immediately moves the carousel strip to the given item index (clamped to the valid range), cancelling any in-progress gesture or animation. The model transitions to the `free` state.

The public state includes a discriminated dismiss union:

```typescript
type CarouselPublicState = {
  isCarouselSettled: boolean;
  carouselTranslateX: number;
  items: Record<string, { transformX: number; transformY: number; scale: number }>;
} & (
  | { isDismissed: false; dismissProgress: number }
  | { isDismissed: true; dismissProgress: 1 }
);
```

The private state is a tagged union that tracks whether a gesture is targeting the carousel strip or an individual item:

```typescript
type CarouselPrivateState =
  | { type: "free";       itemIds: ...; carousel: TransformPrivateState; items: Record<string, TransformPrivateState> }
  | { type: "carousel";   itemIds: ...; carousel: TransformPrivateState; items: Record<string, TransformPrivateState> }
  | { type: "items";      itemIds: ...; carousel: TransformPrivateState; items: Record<string, TransformPrivateState>; activeItemId: string }
  | { type: "dismissing"; itemIds: ...; carousel: TransformPrivateState; items: Record<string, TransformPrivateState>; activeItemId: string; dismissX: number; dismissY: number; dismissVx: number; dismissVy: number; dismissPivotX: number; dismissPivotY: number; lastUpdatedAt: number }
  | { type: "dismissed";  itemIds: ...; carousel: TransformPrivateState; items: Record<string, TransformPrivateState>; activeItemId: string; dismissX: number; dismissY: number; dismissPivotX: number; dismissPivotY: number };
```

- **free** — no active gesture; animations may still be running on carousel or items.
- **carousel** — gesture is scrolling the carousel strip.
- **items** — gesture is targeting `activeItemId` for pan/zoom.
- **dismissing** — user is actively swiping up/down to dismiss; position tracked in flat fields (not `TransformPrivateState`) because dismiss motion has no bounds and scale is derived from `y`.
- **dismissed** — user released past the dismiss threshold; terminal state until the component unmounts. Retains `activeItemId`/`dismissX`/`dismissY`/`dismissPivotX`/`dismissPivotY` so the active item renders at the release position (needed for the view transition to start from the correct location).

Tick advances both carousel and items animations in every phase.

#### Transform and TransformVelocity

The model reducers represent motion state as two flat types:

- `Transform: { x: number; y: number; scale: number }` — current position and scale.
- `TransformVelocity: { vx: number; vy: number; logVScale: number }` — rates of change. `vx`/`vy` are linear (px/ms); `logVScale` is in log-space (log-units/ms) for natural pinch-zoom behavior.

`x`, `y`, and `scale` are treated as an atomic unit — operations that change scale also adjust translation via `applyScalePivot` to maintain the correct pivot point. A shared `lastUpdatedAt: number` (NaN when never updated) tracks when the state was last changed.

Velocity is internal state and is not included in the public `State`.


## Store Module

The Store module is a generic animation loop. It drives the animation frame, dispatches tick actions on each frame to advance inertia or spring animations, and emits the resulting public state to subscribers.

The Store has a continuous update loop driven by `requestAnimationFrame()`. The tick action is dispatched on each frame. Gesture events from Interpreters reach the reducer via `dispatch`, which the caller wires up externally.

The Store's update loop emits state to subscribers on every frame where the state changes. The loop pauses automatically when the reducer returns the same object reference as the previous state (indicating the state has settled), and resumes when `dispatch` is called. This pause/resume behavior is an implementation detail of the Store — other modules must not depend on it. The reference equality contract described in [State Machine Design](#state-machine-design) is what enables this optimization.

`flush()` synchronously publishes the current state to all subscribers without waiting for the next animation frame. Use it when you need subscribers to reflect a `dispatch` call immediately — for example, to update the DOM before the browser paints.

```typescript
type Store<TState, TAction = StoreAction> = {
  subscribe: (cb: StateCallback<TState>) => UnsubscribeFn;
  dispatch: (action: TAction) => void;
  /** Synchronously fires all subscribers with the current public state. */
  flush: () => void;
  unmount: UnmountFn;
};

declare function createStore<TPrivateState, TState, TExtraAction = never>(
  model: Model<TState, TPrivateState, StoreAction | TExtraAction>,
): Store<TState, StoreAction | TExtraAction>;
```

To create a transform store and wire up interpreters:

```typescript
const store = createStore(createModel(config));
const mounted = interpreters.map(i => i(element));
const stops = mounted.map(i => i.subscribe(e => store.dispatch(e)));
// Later: stops.forEach(stop => stop()); store.unmount(); mounted.forEach(i => i.unmount());
```

## Renderer Module

The Renderer module receives transform information from the Store and applies it to the actual DOM element. This includes logic for scaling and translating the element using CSS transforms.

The Renderer subscribes to the Store and updates the target element's CSS transform whenever State changes. The Renderer holds no internal state and is responsible only for side effects (DOM updates).

```typescript
type Renderer<TState> = (element: Element, store: Store<TState>) => MountedRenderer;
type MountedRenderer = {
  unmount: UnmountFn;
};

declare function createRenderer(): Renderer<State>;
```

## Module Dependencies

- The Renderer depends on the Store. The Renderer subscribes to the Store's state and applies transformations to the target element.
- The Store depends on the Model. The Store drives the animation loop and forwards externally dispatched actions to the Model.
- The Model does not depend on the Store, Interpreter, or Renderer. It is a pure function from state and action to state.
- The Interpreter does not depend on the Store, Model, or Renderer. The Interpreter focuses solely on processing user input and emitting InterpreterEvents.

## Testing Policy

Each module should be tested individually through unit tests. The Interpreter module requires tests to verify that correct InterpreterEvents are emitted from user input, including both motion events and release events. The Model module requires tests to verify that the reducer produces correct state transitions for every combination of state and action. The Store module requires tests to verify the animation loop mechanics: that interpreter events are forwarded to the reducer, that subscribers receive the output of `toPublicState` on each frame, and that the loop stops after unmount. The Renderer module requires tests to verify that correct CSS transforms are applied based on the Store's state.
