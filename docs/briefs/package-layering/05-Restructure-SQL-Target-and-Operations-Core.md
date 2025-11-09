## Slice 5 — Restructure SQL Target & Operations Core

### Context
- Even after slicing lanes, `@prisma-next/sql-target` still combines multiple concerns: SQL contract types, emitter hook implementation, and the operation registry runtime logic that attaches operations to column builders.
- We need to align with ADR 140 + the Operation Registry brief (Slice 11) by:
  1. Splitting SQL target responsibilities into clearly scoped packages (`contract-types`, `operations`, `emitter`) under `packages/targets/sql/`.
  2. Extracting a target-neutral `@prisma-next/operations` package (in the core ring) so authoring, lanes, and runtime all share the same registry/contracts/capability gating helpers regardless of target family.
- This slice focuses on the package-level reorganization; behavioral improvements (e.g., operation chaining) already landed in Slice 11 and should remain intact after the move.

### Goals
1. **Create `@prisma-next/operations` (core ring)**
   - Move operation registry interfaces, capability gating helpers, and the canonical `executeOperation` helper from `packages/sql-query/src/operations-registry.ts` / `packages/sql-target/src/operations-registry.ts` into `packages/core/operations`.
   - Ensure this package has no SQL-specific imports; it should only depend on `@prisma-next/contract` types.
   - Provide curated exports so both authoring packages (`contract-authoring`, `sql-contract-ts`), relational core, lanes, adapters, and runtime can import from a single source of truth.

2. **Restructure SQL target packages**
   - Split `packages/sql-target` into subpackages (or subpath exports) under `packages/targets/sql/`:
     - `contract-types` (`@prisma-next/sql-contract-types`)
     - `operations` (`@prisma-next/sql-operations`) – contains SQL-specific operation manifests and lowering templates.
     - `emitter` (`@prisma-next/sql-contract-emitter`) – the SQL family’s emitter hook implementation.
   - Adjust package.json/tsconfig/vitest configs accordingly and ensure each package exports curated entry points.

3. **Wire up consumers**
   - Update `@prisma-next/sql-relational-core`, lane packages, authoring packages, runtime, and adapters to import operation helpers/types from `@prisma-next/operations` and SQL-specific manifests from `@prisma-next/sql-operations`.
   - Update the emitter to import SQL contract types/emitter hook via the new packages.
   - Ensure extension packs/adapters register operations via the new module (e.g., `@prisma-next/sql-operations` providing manifests consumed by `@prisma-next/operations`).

4. Maintain backwards compatibility temporarily by keeping subpath exports or re-exports from `@prisma-next/sql-target`, but mark them with TODO comments for Slice 7.

### Non-goals
- Changing operation semantics, manifests, or lowering templates.
- Modifying runtime verification logic (Slice 6 handles runtime-core split).
- Removing the legacy `@prisma-next/sql-target` entry point; we keep compatibility exports until the final cleanup slice.

### Deliverables
- `packages/core/operations` populated with the shared registry helpers, plus tests (unit + type tests).
- `packages/targets/sql/contract-types`, `packages/targets/sql/operations`, and `packages/targets/sql/emitter` with standalone builds/tests.
- Updated imports throughout the repo to use the new package names/paths.
- Transitional re-exports in `@prisma-next/sql-target` (with TODOs referencing Slice 7).
- Documentation updates (Slice 12 brief, ADRs) noting the new package boundaries.

### Step Outline
1. Scaffold/verify the three SQL target subpackages (`contract-types`, `operations`, `emitter`) and ensure they are registered in `pnpm-workspace.yaml`, `tsconfig.base.json`, and `turbo` pipelines.
2. Create/complete `packages/core/operations` (if not already done in Slice 1). Move target-neutral operation registry logic into this package and update relational-core/authoring/runtime imports accordingly.
3. Move SQL-specific files into their respective subpackages, adjusting relative imports and exports. Ensure each package exports only its scope (e.g., no emitter logic leaking into contract types).
4. Update consumers (authoring, relational core, lanes, runtime, adapters, emitter tests) to import from the new packages. Add transitional re-exports in `@prisma-next/sql-target`.
5. Run all relevant test suites (see below) plus lint/typecheck/dependency checks.

### Testing / Verification
- `pnpm --filter @prisma-next/operations test`
- `pnpm --filter @prisma-next/sql-contract-types test`
- `pnpm --filter @prisma-next/sql-operations test`
- `pnpm --filter @prisma-next/sql-contract-emitter test`
- `pnpm --filter @prisma-next/emitter test`
- `pnpm --filter @prisma-next/sql-lane test` and `pnpm --filter @prisma-next/sql-orm-lane test`
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Notes
- Keep compatibility exports in `@prisma-next/sql-target` but annotate them with TODOs referencing Slice 7 removal.
- Coordinate closely with the Slice 11 brief; ensure any type-level guarantees introduced there persist after the package move.
- Document any temporary suppression or workaround so the next slice (runtime split) knows what to expect.
