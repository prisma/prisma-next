## Slice 4 — Split SQL Lanes

### Context
- With Slice 3 complete, `@prisma-next/sql-relational-core` now provides shared table/column/param primitives. However, the actual SQL query lanes (relational DSL + raw helpers + ORM builder) are still bundled inside `@prisma-next/sql-query`.
- We need two dedicated packages under `packages/sql/lanes/`:
  - `@prisma-next/sql-lane`: the relational DSL (fluent builder, raw lane helpers, AST lowering utilities, plan factory glue).
  - `@prisma-next/sql-orm-lane`: the ORM builder (`orm-builder.ts`, include helpers, relation filters, ORM-specific type utilities).
- This separation lets consumers opt into only the lane(s) they need and prepares us for future families that may reuse the relational DSL but not the ORM.

### Goals
1. Scaffold `packages/sql/lanes/sql-lane` and `packages/sql/lanes/orm-lane` with package metadata, tsconfig, vitest config, and curated exports mirroring today’s entrypoints (`sql`, `schema`, `param`, `orm`).
2. Move DSL-specific files (`sql.ts`, `sql.ts` helpers, `raw.ts`, AST lowering utilities, plan builder helpers) and their tests into `sql-lane`.
3. Move ORM-specific files (`orm-builder.ts`, `orm-types.ts`, `orm-include-child.ts`, `orm-relation-filter.ts`, any include/projection helpers) plus their tests into `orm-lane`.
4. Update imports so each lane package depends only on:
   - `@prisma-next/sql-relational-core`
   - Target types (`@prisma-next/sql-contract-types`, `@prisma-next/sql-operations`, etc.)
   - Shared utilities (errors, plan types) as needed.
   Neither package should import from the other.
5. Preserve existing public APIs by adding transitional re-exports in `@prisma-next/sql-query` (e.g., `export * from '@prisma-next/sql-lane/sql'`). These shims stay until Slice 7 removes the legacy package.
6. Update examples/tests/CLI references to import from the new packages where practical (or via the shims if needed for incremental rollout).

### Non-goals
- Removing `@prisma-next/sql-query` entirely (Slice 7).
- Introducing ORM behavior changes, new features, or performance tweaks.
- Touching runtime/adapters—this slice only reorganizes lane packages.

### Deliverables
- Two fully-configured packages:
  - `@prisma-next/sql-lane` exporting the relational DSL (and raw lane) with tests running in its own suite.
  - `@prisma-next/sql-orm-lane` exporting the ORM builder and helpers with its own tests.
- Transitional re-export modules inside `@prisma-next/sql-query`.
- Updated documentation (Slice 12 brief, README references, examples) describing the new package locations.

### Step Outline
1. **Scaffold packages**
   - Add package.json/tsconfig/vitest configs for both packages.
   - Configure `exports` blocks so consumers can import `@prisma-next/sql-lane/sql`, `@prisma-next/sql-lane/schema`, etc.

2. **Move files**
   - For `sql-lane`: move `sql.ts`, `schema.ts` entry proxies (if any remain), raw helpers, AST lowering utilities, plan builder helpers, and associated type definitions/tests.
   - For `orm-lane`: move `orm-builder.ts`, include helpers, relation filter builders, ORM type utilities, and their tests/fixtures.
   - Adjust relative imports to reference `@prisma-next/sql-relational-core` and the new package paths.

3. **Update references**
   - Modify CLI/examples/tests to import from the new packages (or transitional shims).
   - Update `tsconfig.base.json` paths, `pnpm-workspace.yaml`, and `turbo` pipelines to include the new packages.

4. **Add transitional re-exports**
   - In `packages/sql-query/src/exports`, add modules that re-export from the new packages. Include TODO comments referencing Slice 7 for removal.
   - Ensure `@prisma-next/sql-query` tests continue to pass by importing through the shims where necessary.

5. **Run verification commands (see below)** and fix any lint/dep violations.

### Testing / Verification
- `pnpm --filter @prisma-next/sql-lane test`
- `pnpm --filter @prisma-next/sql-orm-lane test`
- `pnpm --filter @prisma-next/sql-query test`
- `pnpm --filter examples/prisma-next-demo test` (or whichever example exercises both lanes)
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Notes
- Keep the new packages tree-shakeable: export only curated entry points, avoid wildcard exports from `src`.
- Document any remaining references to `@prisma-next/sql-query` so Slice 7 can remove the shims confidently.
- Coordinate with Slice 5 to ensure operation registry imports still work after the package split.

### Known Issues

**ORM-lane dependency on sql-lane**: Currently, `orm-lane` imports from `sql-lane` to build queries, which violates Goal 4 (neither package should import from the other). This is tracked with a temporary exception in `scripts/check-imports.mjs`. The `orm-lane` package should be refactored to build AST nodes directly instead of using the SQL lane builder. See TODO comment in `scripts/check-imports.mjs` for details.
