---
name: typescript-review
description: Review TypeScript code and suggest improvements across multiple dimensions including type safety, performance, bundle size, dependencies, and API design.
context: fork
argument-hint: 1. Declare whether you wish to review a planned code change or an executed code change. 2. Describe the planned/executed code change in detail, and ask for suggestions to improve it.
---

## Workflow

1. Understand the relevant part of the codebase using the Explore agent.
2. Review planned/executed TypeScript code changes and suggest improvements based on the principles below.

## Type Safety

Make the most upstream types as strict as possible. The types of external input values are often the most upstream. If you see symptoms like the following, it's a sign to review the upstream types.

### Type assertions with `as` or `!`

Don't use `as` to type external inputs such as fetch, file reading, localStorage/IndexedDB.
Instead, use a validation library like valibot.

### Optional properties with correlations

If the presence of one optional property of an object is related to the presence of another optional property, consider defining the type with a union.
For example, `{ a?: string, b?: string }` is less clear than `{ type: "foo", a: string } | { type: "bar", b: string }`.

## Performance

### High-frequency React state updates

Avoid updating React state in high-frequency triggers such as `touchmove` or `requestAnimationFrame`.

- Example: updating React state on `touchmove` to update the UI
- Fix: move high-frequency updates to refs and update the UI imperatively. Reserve React state for low-frequency UI state.

## Bundle Size

### Tree-shaking

Avoid code structures that prevent tree-shaking. Prefer letting callers import and pass behavior directly over selecting behavior via string identifiers.

- Example: `interpreters: ["touch", "mouse"]` (string names) prevents tree-shaking unused interpreters
- Fix: `interpreters: [new TouchInterpreter(), new MouseInterpreter()]` — callers instantiate and pass

## Module Dependencies

### Unintended dependency creep

When adding features, do not introduce imports that violate the intended module dependency graph.

- Example: adding a React import into a React-agnostic core module
- Fix: before implementing the feature, restructure the codebase so the dependency graph remains clean, even if that means a broader refactor. In the planning phase, treat dependency violations as blockers and refactor first.

## API Design

### Unnecessary backward compatibility

Do not make arguments optional purely to preserve backward compatibility. Optional arguments should be optional because they are genuinely optional, not because changing call sites is inconvenient.

- Fix: update all call sites. In the planning phase, refactor the codebase first so the new API is easy to adopt.

### Unnecessary indirection

Remove abstractions that no longer serve a purpose.

- Example: an extra layer of wrapping or a factory function with no parameters or meaningful logic.
- Example: re-export a function from another module purely to avoid updating imports in call sites, when the re-export adds no meaningful abstraction.

### Fix problems at the right layer

When a bug or limitation is caused by a lower-level primitive, fix it there even if that means more work.

- Ask: "Am I patching a symptom here, or fixing the root cause?"
