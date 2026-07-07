# Technology Stack

This project uses a monorepo structure to manage the library and the demo application.

## Packages

| Package | Role |
|---------|------|
| `@thigma/core` | Framework-agnostic gesture library |
| `@thigma/react` | React component wrappers around `@thigma/core` |
| `@thigma/demo` | Demo application for manual testing |

## Directory Structure

```
packages/
  core/                  # @thigma/core
    src/
      interpreter/
        touch.ts
        mouse-drag.ts
        mouse-wheel.ts
        double-tap.ts
        index.ts
      model/
        primitives.ts    # Transform, TransformVelocity, applyScalePivot, computeDtMs
        transform.ts     # TransformPrivateState, createTransformReduce
        simple.ts        # createModel
        carousel.ts      # createCarouselModel
        index.ts
      store/
        index.ts
      renderer/
        index.ts
      types.ts           # InterpreterEvent, State, and common primitive types
    package.json
    tsconfig.json
  react/                 # @thigma/react
    src/
      PinchPanContainer.tsx
      CarouselContainer.tsx
      ScalableCarouselContainer.tsx
      index.ts
    package.json
    tsconfig.json
  demo/                  # @thigma/demo
    src/
    package.json
    tsconfig.json
package.json             # workspace root
```

## Tools and Frameworks

- Common
  - TypeScript
  - Vite
- `@thigma/core`
  - Vitest
- `@thigma/react`
  - React (peer dependency)
- `@thigma/demo`
  - React
  - Tailwind CSS
  - The demo is UI-focused and does not include automated tests.
