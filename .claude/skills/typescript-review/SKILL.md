---
name: typescript-review
description: Review TypeScript code and suggest improvements across multiple dimensions including type safety, performance, bundle size, dependencies, and API design.
argument-hint: 1. Declare whether you wish to review a planned code change or an executed code change. 2. Describe the planned/executed code change in detail, and ask for suggestions to improve it.
---

## Workflow

1. When reviewing existing code, use the Explore agent to understand the relevant part of the codebase. Write the response to a temporary file.
2. When reviewing a planned change, use the Plan agent to make a detailed implementation plan. You may skip this step only if there's a already a plan file. Write the response to a temporary file.
3. Determine which principle groups are relevant to the change.
4. For each relevant principle group, invoke the Agent tool in parallel — one call per principle group below. Pass each agent:
   - The user's change description (from the conversation)
   - The path to the Explore/Plan agent result
   - The full text of the principles the agent is responsible for (quoted from the groups below)
   - The instruction: "Return your findings as a list. For each finding, state the principle violated and describe the problem. If you find no issues, return an empty list."
5. Write the results from all agents to {{cwd}}/typescript-review-findings.local.md in the following format:

   ```
   ### Group X: THE_NAME_OF_THE_PRINCIPLE

   - review finding 1
   - review finding 2
   ...
   ```

6. Evaluate every single finding from all agents, even if they seem minor. Evaluate each finding into one of "valid", "invalid" or "out of scope". Use "out of scope" if the finding is technically correct but not relevant to the current change.
7. Report all the findings to the user in a single message, along with your evaluation.

- Note: Spin up exactly one agent per principle group. Do not combine multiple principle groups into a single agent.

## Principle Groups

### Group 1: Do more with less

<when-to-use>Always</when-to-use>

Don't try to solve the problem with more code. Instead, leverage existing abstractions.

When adding a new feature: generalize existing abstractions to accommodate both existing and new use cases.
When fixing a bug: fix the root cause, not just the symptom.

### Group 2: Type Safety

<when-to-use>Working on a TypeScript project</when-to-use>

Make the most upstream types as strict as possible. The types of external input values are often the most upstream. If you see symptoms like the following, it's a sign to review the upstream types.

#### Type assertions with `as` or `!`

Don't use `as` to type external inputs such as fetch, file reading, localStorage/IndexedDB.
Instead, use a validation library like valibot.

#### Optional properties with correlations

If the presence of one optional property of an object is related to the presence of another optional property, consider defining the type with a union.
For example, `{ a?: string, b?: string }` is less clear than `{ type: "foo", a: string } | { type: "bar", b: string }`.

### Group 3: Performance + Bundle Size

<when-to-use>Working on a front end code</when-to-use>

#### High-frequency React state updates

Avoid updating React state in high-frequency triggers such as `touchmove` or `requestAnimationFrame`.

- Example: updating React state on `touchmove` to update the UI
- Fix: move high-frequency updates to refs and update the UI imperatively. Reserve React state for low-frequency UI state.

#### Tree-shaking

Avoid code structures that prevent tree-shaking. Prefer letting callers import and pass behavior directly over selecting behavior via string identifiers.

- Example: `interpreters: ["touch", "mouse"]` (string names) prevents tree-shaking unused interpreters
- Fix: `interpreters: [new TouchInterpreter(), new MouseInterpreter()]` — callers instantiate and pass

### Group 4: Module Dependencies

<when-to-use>Working on a TypeScript project</when-to-use>

Run the following script to identify modules with few dependents, which may indicate that they are not widely used and could be candidates for deletion or refactoring.

```sh
#!/usr/bin/env bash
# For each module, list the modules that import it.
# madge outputs a forward dependency map, so we reverse it with jq to get the reverse dependencies.
set -euo pipefail
cd "$(dirname "$0")"

npx --yes madge --extensions ts,tsx --ts-config tsconfig.json --json src \
  | jq -r '
      [ to_entries[] | .key as $from | .value[] | {dep:., from:$from} ]
      | group_by(.dep)
      | map({dep:.[0].dep, dependents:(map(.from)|unique)})
      | sort_by(-(.dependents|length))
      | .[]
      | "\(.dep)  (\(.dependents|length))\n" + (.dependents | map("  - \(.)") | join("\n"))
    '

```

#### Keep exports minimal

<when-to-use>Working on a TypeScript project</when-to-use>

Minimize the number of exports from a module.

- Example: a variable is defined in module A but only used in module B.
- Example: re-exporting a function from another module for backward compatibility.
- Fix: relocate code aggressively to reduce the need for cross-module imports and promote colocation.
- Fix: update all call sites to import directly from the original module.

#### Dependency creep

When adding features, do not introduce imports that violate the intended module dependency graph.

- Example: adding a React import into a React-agnostic core module
- Fix: before implementing the feature, restructure the codebase so the dependency graph remains clean, even if that means a broader refactor. In the planning phase, treat dependency violations as blockers and refactor first.

### Group 5: API Design

<when-to-use>Always</when-to-use>

#### Unnecessary backward compatibility

Do not make arguments optional purely to preserve backward compatibility. Optional arguments should be optional because they are genuinely optional, not because changing call sites is inconvenient.

- Fix: update all call sites. In the planning phase, refactor the codebase first so the new API is easy to adopt.

#### Unnecessary indirection

Remove abstractions that no longer serve a purpose.

- Example: an extra layer of wrapping or a factory function with no parameters or meaningful logic.
- Example: re-export a function from another module purely to avoid updating imports in call sites, when the re-export adds no meaningful abstraction.

#### Fix problems at the right layer

When a bug or limitation is caused by a lower-level primitive, fix it there even if that means more work.

- Ask: "Am I patching a symptom here, or fixing the root cause?"

### Group 6: Documentation

<when-to-use>Always</when-to-use>

#### Keep documentation minimum

Document principles that future developers must comply with. Don't document what can be inferred from the code.
