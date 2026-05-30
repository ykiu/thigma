# Technology Stack

This project uses a monorepo structure to manage the library and the demo application.

## Packages

| Package | Role |
|---------|------|
| `@mimosa/core` | Library |
| `@mimosa/demo` | Demo application for manual testing |

## Directory Structure

```
packages/
  core/                  # @mimosa/core
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
  demo/                  # @mimosa/demo
    src/
    package.json
    tsconfig.json
package.json             # workspace root
```

## Tools and Frameworks

- Common
  - TypeScript
  - Vite
- `@mimosa/core`
  - Vitest
- `@mimosa/demo`
  - React
  - Tailwind CSS
  - The demo is UI-focused and does not include automated tests.
