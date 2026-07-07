This library provides components to enable gesture-based screen manipulation such as pinch and pan, commonly seen in native apps on iOS and Android, on the web.

Note: This library is in early development. Don't stick to keeping the current API. Rather, pursue the best API you can think of, and we'll iterate on it together.

## Document Structure

You can refer to the following documents as needed.

- [Architecture](./design/00_architecture.md)
- [Technology Stack](./design/01_technology_stack.md)

## Workflow

When making changes to the codebase, follow this workflow:

1. Ask for clarification if the change is not clearly defined.
2. Plan your change.
3. Ask for feedback on your plan.
4. Review the plan with the "typescript-review" skill and evaluate the feedback.
5. Update documents as needed.
6. Implement your change in a test-driven manner.
7. Run code quality checks
   `npm run tsc && npm run format && npm run lint && npm run test`.
8. Review your implementation with the "typescript-review" skill and evaluate the feedback.
9. Iterate on your implementation based on feedback until finalized.

## Publishing

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and npm publishing.

### Workflow

1. **Add a changeset** after making changes to `@thigma/core` or `@thigma/react`:
   ```
   npx changeset
   ```
   Follow the interactive prompts to select the affected packages and the semver bump type (patch / minor / major), then write a short summary of the change. Commit the generated file in `.changeset/`.

2. **Version PR** — When changesets are merged to `main`, the GitHub Actions release workflow (`release.yml`) runs `changesets/action`, which opens (or updates) a "Version Packages" pull request. This PR bumps `package.json` versions and updates `CHANGELOG.md` files based on the accumulated changesets.

3. **Publish** — Merging the Version PR back to `main` triggers the workflow again. This time `changesets/action` detects that the versions have already been bumped, so it runs `npx changeset publish` to publish the packages to npm. Provenance attestation is enabled via `npm config set provenance true` in the workflow.

Publishing uses [npm trusted publishers](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived `NPM_TOKEN` is needed. Each package must have the trusted publisher configured on npmjs.com (Settings → Trusted Publisher → GitHub Actions, workflow: `release.yml`).

## Human Language

Always use English to write code comments, commit messages, documentation and GitHub PRs/issues/comments.
