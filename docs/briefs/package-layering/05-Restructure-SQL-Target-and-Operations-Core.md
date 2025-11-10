## Slice 5 — Restructure SQL Target & Operations Core

### Context
- Even after slicing lanes, `@prisma-next/sql-target` still combines SQL contract types, emitter hook logic, and operation registry behavior. The operation registry also has fragments living in lane packages.
- ADR 140 + the Operation Registry brief (Slice 11) require us to extract target-agnostic operation helpers and split SQL target concerns into well-scoped packages (`contract-types`, `operations`, `emitter`).
- This slice prepares the codebase for future targets by centralizing shared logic in `@prisma-next/operations` and slimming `@prisma-next/sql-target` down to curated subpackages.

### Goals
1. **Stand up `@prisma-next/operations` (core ring)**
   - Move operation registry types, capability gating helpers, and the canonical `executeOperation` code from lane packages into `packages/core/operations`.
   - Keep this package target-neutral; it should depend only on `@prisma-next/contract` types.
   - Provide exports used by authoring, relational core, lanes, runtime, and adapters.
2. **Split SQL target responsibilities**
   - Create/complete `packages/targets/sql/contract-types`, `packages/targets/sql/operations`, and `packages/targets/sql/emitter` with their own build/test configs.
   - Move the relevant files from `packages/sql-target/src` into those packages.
   - Keep curated exports so consumers import only what they need.
3. **Update consumers**
   - Change authoring packages, relational core, lanes, runtime, and adapters to import from `@prisma-next/operations` and the new SQL packages.
   - Keep transitional re-exports in `@prisma-next/sql-target` with TODO comments referencing Slice 7.
4. **Verify extension packs and adapters register operations through the new module.**

### Non-goals
- Changing how operations behave or lowering templates work.
- Touching runtime verification logic (Slice 6 handles runtime split).
- Removing the legacy `@prisma-next/sql-target` entry point entirely (Slice 7).

### Deliverables
- `packages/core/operations` populated with shared registry helpers and tests.
- `packages/targets/sql/{contract-types,operations,emitter}` containing the SQL-specific pieces with independent build/test configs.
- Updated imports throughout the repo pointing at the new packages, plus transitional re-exports.
- Documentation (Slice 12, ADR 140) reflecting the new boundaries.

### Step Outline
1. Scaffold/verify the SQL target subpackages and ensure they are listed in `pnpm-workspace.yaml`, `tsconfig.base.json`, and `turbo.json`.
2. Move target-neutral operation helpers into `@prisma-next/operations` and update relational core/authoring to import from it.
3. Move SQL-specific files into the new target subpackages, fixing relative imports and adjusting exports.
4. Update consumers (authoring, lanes, runtime, adapters, emitter tests) to reference the new packages. Add transitional re-exports in `@prisma-next/sql-target`.
5. Run all relevant test suites (SQL target unit tests, emitter tests, lane tests) plus lint/typecheck/dependency checks.

### Testing / Verification
- `pnpm --filter @prisma-next/operations test`
- `pnpm --filter @prisma-next/sql-contract-types test`
- `pnpm --filter @prisma-next/sql-operations test`
- `pnpm --filter @prisma-next/sql-contract-emitter test`
- `pnpm --filter @prisma-next/emitter test`
- `pnpm --filter @prisma-next/sql-lane test`
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Notes
- Keep compatibility exports in `@prisma-next/sql-target` but annotate them for removal in Slice 7.
- Coordinate with Slice 11 to ensure type-level guarantees remain intact after the move.
- Document any temporary suppressions so subsequent slices know what to clean up.
