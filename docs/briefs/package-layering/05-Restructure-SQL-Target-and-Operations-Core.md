## Slice 5 — Restructure SQL Target & Operations Core

### Context
- With lanes separated, the SQL target package (`@prisma-next/sql-target`) still lumps contract types, emitter hooks, and operation registry logic together.
- We also want a target-neutral operations core so both authoring validation and lanes share one implementation (per ADR 140 + Slice 11 brief).

### Goals
1. Move SQL contract-type definitions, emitter hook, and target-specific helpers into `packages/targets/sql/{contract-types,emitter,operations}` with curated exports.
2. Extract a `@prisma-next/operations` (core) package hosting the operation registry interfaces, capability gating helpers, and execution entry point.
3. Update `@prisma-next/sql-relational-core` and the SQL target packages to consume the core operations module instead of duplicating logic.
4. Ensure extension packs/adapters register operations via the new module.
5. Keep runtime + authoring surfaces compiling with the new imports.

### Non-goals
- Changing operation behavior beyond import paths.
- Touching runtime verification logic (Slice 6 handles runtime split).
- Removing SQL-specific exports from `@prisma-next/sql-target` until downstream packages switch to the new structure.

### Deliverables
- `packages/core/operations` package with build/test config.
- Reorganized SQL target folder with separate packages or subpath exports for contract types, emitter hook, and operation manifests.
- Updated imports across repo to use the new locations.

### Step Outline
1. Create `@prisma-next/operations` package; move shared types/helpers there.
2. Split `@prisma-next/sql-target` contents into sub-packages or subpath exports as outlined in Slice 12 / ADR 140.
3. Update authoring, lanes, runtime, and adapter code to import from the new modules.
4. Run relevant unit/integration tests (emitter, operation registry, adapter lowering).

### Testing / Verification
- `pnpm --filter @prisma-next/operations test`
- `pnpm --filter @prisma-next/sql-target test`
- `pnpm --filter @prisma-next/emitter test`
- `pnpm --filter @prisma-next/sql-lane test`

### Notes
- Keep compatibility exports in `@prisma-next/sql-target` if necessary, but mark them deprecated for removal in Slice 7.
- Coordinate with the existing Slice 11 brief (Operation Registry Type Alignment) to ensure type/runtime alignment stays intact.
