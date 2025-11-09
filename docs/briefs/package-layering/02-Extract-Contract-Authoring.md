## Slice 2 — Extract Contract Authoring

### Context
- Builds on Slice 1 scaffolding; placeholder packages exist.
- Contract builders (`packages/sql-query/src/contract-builder.ts`, `contract.ts`, `schemas/`, related tests) still live inside `@prisma-next/sql-query`.
- Objective is to move authoring-only code into `packages/authoring/contract-authoring` (and supporting `contract-ts` if needed) without breaking current consumers.

### Goals
1. Move the contract builder implementation + helpers + JSON schemas into `packages/authoring/contract-authoring`.
2. Export the same public API from the new package and re-export from `@prisma-next/sql-query` to keep downstream imports working temporarily.
3. Ensure tests (`contract-builder.integration.test.ts`, schema snapshots) run within the new package or pointed at it.
4. Update documentation and path aliases to reference `@prisma-next/contract-authoring`.

### Non-goals
- Changing builder behavior, schema formats, or CLI wiring.
- Moving runtime schema/table builders (handled in later slices).
- Removing the transitional re-export; that happens in Slice 7 once no callers remain.

### Deliverables
- `packages/authoring/contract-authoring` with source, tests, build config, and package metadata.
- Updated imports in repo to use `@prisma-next/contract-authoring` where appropriate (e.g., CLI, tests).
- `@prisma-next/sql-query` re-export (`export * from '@prisma-next/contract-authoring'`) plus TODO note referencing Slice 7 for cleanup.

### Step Outline
1. Copy/move files from `packages/sql-query/src/{contract-builder.ts,contract.ts}` and `schemas/` into the new package, fixing relative imports.
2. Create a build entry (`exports`, `tsconfig`, `vitest` config) mirroring the source package structure.
3. Update references in CLI/tests to import from the new package.
4. Add transitional re-export in `packages/sql-query/src/exports/contract-builder.ts` (or equivalent) with comment.
5. Run the sql-query and new package test suites.

### Testing / Verification
- `pnpm --filter @prisma-next/contract-authoring test`
- `pnpm --filter @prisma-next/sql-query test` (ensures re-export path still green)
- `pnpm --filter @prisma-next/contract-authoring typecheck`

### Notes
- Preserve schema JSON assets (keep in `files` array for publishing).
- Update docs referencing the contract builder (if they pointed to `@prisma-next/sql-query`).
