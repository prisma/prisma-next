## Slice 2 — Extract Contract Authoring

### Context
- Slice 1 created the directory skeleton + guardrails, but all contract-authoring code still lives inside `@prisma-next/sql-query`.
- The current implementation mixes two concerns:
  1. A SQL-specific TypeScript authoring surface (builders with SQL storage assumptions, SQL contract types).
  2. A target-agnostic builder core (state machines, canonicalization helpers, schema emission helpers) that should eventually be shared by other families.
- This slice is about untangling those responsibilities without breaking existing callers (CLI, tests, examples). We will move the SQL surface into the SQL family namespace first, then extract the neutral core into the authoring ring.

### Goals
1. **Phase 1 — Relocate the existing SQL authoring surface into the SQL family namespace**
   - Create `packages/sql/authoring/sql-contract-ts` with its own `package.json`, `tsconfig.json`, `vitest.config.ts`, and `src/exports`.
   - Move the existing SQL contract authoring code (`packages/sql-query/src/contract-builder.ts`, `contract.ts`, `schemas/`, plus related tests/fixtures) into this directory.
   - Update import paths so everything now references `@prisma-next/sql-contract-ts`. Adjust `tsconfig.base.json` path aliases and the package exports accordingly.
   - Ensure the package builds/tests in its new location without changing runtime behavior or TypeScript signatures.
   - Add transitional re-exports in `@prisma-next/sql-query` pointing to `@prisma-next/sql-contract-ts` with TODO comments referencing Slice 7 cleanup.

2. **Phase 2 — Extract the target-agnostic contract authoring core**
   - Create `packages/authoring/contract-authoring` and move all family-neutral builder primitives into it:
     - Builder state types (table/model definitions, column metadata)
     - Canonicalization helpers and schema emission logic
     - JSON schema validation helpers that do not need SQL-specific types
   - This package must depend only on `@prisma-next/contract` and other core modules; it cannot import from `@prisma-next/sql-*`.
   - Refactor `packages/sql/authoring/sql-contract-ts` so it composes `@prisma-next/contract-authoring` with SQL-specific contract types/mappings (`SqlContract`, `SqlStorage`, etc.) and re-exports the same public API (`contractBuilder`, TypeScript helper types).

3. Decide which JSON schemas belong to the core vs the SQL surface. Shared schemas should move to `contract-authoring`; SQL-only schemas stay in `sql-contract-ts`. Update the `files` arrays so they are published from the correct packages.
4. Update CLI/tests/examples to import from the new packages (`@prisma-next/sql-contract-ts` and, where needed, `@prisma-next/contract-authoring`). Ensure `pnpm --filter @prisma-next/sql-query test` still passes by virtue of the transitional re-export.
5. Update docs (Slice 12, reference docs, README sections mentioning contract authoring) to reference the new package names and clarify which package is target-agnostic vs SQL-specific.

### Non-goals
- Changing builder semantics, emitted JSON schemas, or CLI wiring. Behavior must remain identical to the current implementation.
- Moving runtime schema/table builders (those live in the lanes slices).
- Introducing target-specific logic into the authoring ring—`@prisma-next/contract-authoring` must remain family neutral.
- Removing transitional re-exports; that cleanup happens in Slice 7 once all callers migrate.

### Deliverables
- `packages/sql/authoring/sql-contract-ts` populated with the existing SQL authoring code, published as `@prisma-next/sql-contract-ts`, and verified via its own test suite.
- `packages/authoring/contract-authoring` containing the extracted target-neutral builder core, along with tests that cover its functionality independent of SQL types.
- Updated imports/path aliases/docs so:
  - CLI/tests/examples consume `@prisma-next/sql-contract-ts`.
  - Any shared authoring utilities reference `@prisma-next/contract-authoring`.
  - `@prisma-next/sql-query` re-exports `@prisma-next/sql-contract-ts` with a TODO for Slice 7.
- JSON schema assets moved to their owning packages and included in those packages' `files` arrays.

### Step Outline
1. **Phase 1 – Relocate SQL authoring code**
   - Scaffold `packages/sql/authoring/sql-contract-ts` (package metadata, tsconfig, vitest config, `src/exports` entry points mirroring the old structure).
   - Move `contract-builder.ts`, `contract.ts`, JSON schema files, fixtures, and tests from `packages/sql-query` into this directory. Preserve relative paths where possible to minimize changes.
   - Update all imports in the moved files to use relative paths or `@prisma-next/*` aliases as appropriate for the new location.
   - Update `tsconfig.base.json` path aliases to include `@prisma-next/sql-contract-ts` (pointing to the new `src/index.ts`) and ensure the package is listed in `pnpm-workspace.yaml`.
   - Update CLI/tests/examples to import from `@prisma-next/sql-contract-ts`.
   - Add a transitional re-export in `packages/sql-query/src/exports/contract-builder.ts` (or similar) with a TODO referencing Slice 7.
   - Run `pnpm --filter @prisma-next/sql-contract-ts test`, `pnpm --filter @prisma-next/sql-contract-ts typecheck`, and the existing `sql-query` tests to confirm nothing regressed.

2. **Phase 2 – Extract contract-authoring core**
   - Scaffold `packages/authoring/contract-authoring` (package.json, tsconfig, vitest config, src entry points).
   - Identify all family-neutral pieces (builder classes, state types, canonicalization helpers, JSON schema validation utilities) and move them into the core package. Ensure they depend only on `@prisma-next/contract` and other core modules.
   - Update `@prisma-next/sql-contract-ts` to import those primitives from the core package and layer SQL-specific types/mappings on top. The public API should remain identical to what consumers expect today.
   - Decide which JSON schemas belong to the core vs SQL surface; move files accordingly and update import paths.
   - Add/adjust tests:
     - Core package tests covering builder behavior without SQL specifics.
     - SQL surface tests ensuring the combined API behaves the same as before.
     - CLI/tests/examples to ensure they still pass with the refactored packages.
   - Update docs/path aliases referencing the core vs SQL packages.

3. Perform a final sweep:
   - Ensure `pnpm --filter @prisma-next/contract-authoring test`, `pnpm --filter @prisma-next/sql-contract-ts test`, `pnpm --filter @prisma-next/sql-query test`, and `pnpm --filter @prisma-next/cli test` all pass.
   - Verify `pnpm lint` and `pnpm lint:deps` still succeed after the moves.

### Testing / Verification
- `pnpm --filter @prisma-next/sql-contract-ts test`
- `pnpm --filter @prisma-next/sql-contract-ts typecheck`
- `pnpm --filter @prisma-next/contract-authoring test`
- `pnpm --filter @prisma-next/contract-authoring typecheck`
- `pnpm --filter @prisma-next/sql-query test`
- `pnpm --filter @prisma-next/cli test` (or targeted CLI tests that exercise contract authoring)
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Notes
- Preserve schema JSON assets (ensure each owning package lists them in its `files` array so they are published).
- Document any transitional re-exports with TODO comments referencing Slice 7.
- Update documentation (Slice 12 brief, ADR 140 references, reference docs) to state clearly which package is target-neutral vs SQL-specific so future agents know where to add new authoring functionality.

### Goals
1. **Phase 1 — Relocate the existing SQL authoring package into the SQL family namespace:**
   - Create `packages/sql/authoring/sql-contract-ts` (scaffold + package.json, tsconfig, vitest config).
   - Move `contract-builder.ts`, `contract.ts`, `schemas/`, and associated tests from `packages/sql-query` into this new directory.
   - Ensure the package builds/tests in its new location without refactoring internals yet.
   - Update tsconfig/path aliases so the SQL surface is published as `@prisma-next/sql-contract-ts`.

2. **Phase 2 — Extract the target-agnostic core from the relocated package:**
   - Create `@prisma-next/contract-authoring` (`packages/authoring/contract-authoring`) and move shared builder primitives (types, builder classes, schema helpers) into it.
   - Ensure `contract-authoring` depends only on `@prisma-next/contract` and other core packages; no imports from `@prisma-next/sql-*` or other family-specific modules.
   - Refactor `@prisma-next/sql-contract-ts` so it composes `contract-authoring` with SQL-specific types/mappings and re-exports the user-facing API.

3. Move JSON schemas/validation helpers into whichever package owns them (core vs SQL surface). If shared, keep them in `contract-authoring` and import from there.
4. Export the same public API from `@prisma-next/sql-contract-ts` that existing callers use. Add transitional re-exports in `@prisma-next/sql-query` pointing to `@prisma-next/sql-contract-ts` (remove in Slice 7).
5. Relocate tests to the new packages (`packages/authoring/contract-authoring/test`, `packages/sql/authoring/sql-contract-ts/test`) and adjust workspace/test commands.
6. Update documentation (Slice 12, reference docs) and path aliases to reference the new packages.

### Non-goals
- Changing builder behavior, schema formats, or CLI wiring.
- Moving runtime schema/table builders (handled in later slices).
- Introducing target-specific logic into authoring packages—the contract authoring ring must stay neutral and consume only core types plus extension manifests injected via options.
- Removing the transitional re-export; that happens in Slice 7 once no callers remain.

### Deliverables
- `packages/sql/authoring/sql-contract-ts` populated with the SQL authoring code in its new location (Phase 1), published as `@prisma-next/sql-contract-ts`.
- `packages/authoring/contract-authoring` containing the target-neutral builder core, with `sql-contract-ts` refactored to depend on it (Phase 2).
- Updated imports across CLI/tests/examples to use `@prisma-next/sql-contract-ts` (and `@prisma-next/contract-authoring` where appropriate). `@prisma-next/sql-query` re-export with TODO for removal.
- JSON schema assets moved/refactored according to ownership.
- Documentation (docs/briefs, reference pages) updated to mention the new packages.

### Step Outline
1. **Phase 1 – Relocate SQL authoring code:**
   - Create/verify package scaffolding for `packages/sql/authoring/sql-contract-ts` (package.json, tsconfig, vitest config).
   - Move `contract-builder.ts`, `contract.ts`, JSON schemas, and tests into the new directory.
   - Update import paths/exports so everything compiles from the new location; ensure CLI/tests reference `@prisma-next/sql-contract-ts`.
   - Add transitional re-export(s) inside `@prisma-next/sql-query`.

2. **Phase 2 – Extract core + refactor SQL surface:**
   - Create `packages/authoring/contract-authoring` scaffolding.
   - Identify neutral builder primitives (types, state machines, canonicalization helpers) and move them into the core package. Keep the API surface similar so `contract-ts` can wrap it.
   - Update `contract-ts` to consume the core package for builder logic while layering on SQL-specific types/mappings.
   - Decide where JSON schemas/validators live (core vs contract-ts) and update references.
   - Run test suites for both packages and downstream dependents (sql-query, CLI).

3. Update docs/path aliases referencing contract authoring.

### Testing / Verification
- `pnpm --filter @prisma-next/contract-authoring test`
- `pnpm --filter @prisma-next/sql-query test` (ensures re-export path still green)
- `pnpm --filter @prisma-next/contract-authoring typecheck`

### Notes
- Preserve schema JSON assets (keep in `files` array for publishing).
- Update docs referencing the contract builder (if they pointed to `@prisma-next/sql-query`).
