---
name: typescript-review
description: Review TypeScript code and suggest improvements.
context: fork
argument-hint: 1. Declare whether you wish to review a planned code change or an executed code change. 2. Describe the planned/executed code change in detail, and ask for suggestions to improve it.
---

## Workflow

1. Understand the relevant part of the codebase using the Explore agent.
2. Review planned/executed TypeScript code changes and suggest improvements based on the principles and details outlined below.

### Principles

Make the most upstream types as strict as possible. The types of external input values are often the most upstream. If you see symptoms like the following, it's a sign to review the upstream types.

#### Type assertions with as or !

Don't use as to type external inputs such as fetch, file reading, localStorage/IndexedDB.
Instead, use a validation library like valibot.

#### Optional properties with correlations

If the presence of one optional property of an object is related to the presence of another optional property, consider defining the type with a union.
For example, { a?: string, b?: string } is less clear than { type: "foo", a: string } | { type: "bar", b: string }.

### Details

#### Avoid unnecessary re-exports

When you refactor by moving a binding to another module, don't leave a re-export in the original module, as it creates two ways to import the same thing.
