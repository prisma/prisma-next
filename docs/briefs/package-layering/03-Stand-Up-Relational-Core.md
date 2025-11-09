## Slice 3 — Stand Up Relational Core

### Context
- After Slice 2, contract authoring lives outside `@prisma-next/sql-query`, but all relational schema/column builders, parameter helpers, and operation-attachment logic still live inside `packages/sql-query/src`.
- Both the SQL DSL and the ORM builder depend on these primitives. We need to lift them into a dedicated package (`@prisma-next/sql-relational-core`) under the SQL family namespace so future lanes (Slice 4) can consume them without re-copying code.
- This slice is still a “move only” refactor: no behavior changes, just relocating files, adjusting exports, and ensuring tests follow the new package.

### Goals
1. Create `packages/sql/lanes/relational-core` with full scaffolding (package.json, tsconfig, vitest config, `src/index.ts` + curated exports).
2. Move the following files (and any of their dependencies) from `packages/sql-query/src` into the new package:
   - `schema.ts` (table builder + column proxy logic)
   - `types.ts` (column builders, AST types, builder interfaces)
   - `param.ts`
   - `operations-registry.ts` (attach operations to columns)
   - Any helper modules imported exclusively by those files (e.g., errors, type utilities) that should logically live with the core.
3. Ensure `@prisma-next/sql-relational-core` exports all necessary entry points (tables, columns, params, operation helpers) so `sql.ts`, `orm-builder.ts`, and tests can import from it.
4. Relocate relevant test suites (e.g., `column-builder-operations.test.ts`, `column-builder-operation-types.test-d.ts`, any param tests). Update vitest configs so the tests now run under the new package.
5. Update `tsconfig.base.json` paths, `pnpm-workspace.yaml`, and any build scripts so the new package participates in lint/typecheck/test pipelines.
6. Update `@prisma-next/sql-query` (and later, the lane packages) to import exclusively from `@prisma-next/sql-relational-core` for schema/column/param logic.

### Non-goals
- Splitting the SQL vs ORM lanes (Slice 4 owns that).
- Refactoring how operations are defined/registered (Slice 5 will introduce the operations core).
- Changing runtime context wiring or `RuntimeContext` usage; keep current dependencies until Slice 6.

### Deliverables
- A functioning `@prisma-next/sql-relational-core` package with:
  - Source files (`schema.ts`, `types.ts`, `param.ts`, `operations-registry.ts`, and necessary helpers).
  - Tests/examples relocated under `packages/sql/lanes/relational-core`.
  - Build/test configs mirroring other packages (tsup/vitest/biome entries, etc.).
- Updated imports throughout `packages/sql-query` (and any other consumers) pointing to `@prisma-next/sql-relational-core`.
- Documentation updates (Slice 12 brief + ADR links) noting that relational primitives now live in the new package.

### Step Outline
1. Scaffold the new package directory, including placeholder exports and configs.
2. Move the designated files from `packages/sql-query/src` into the new package, fixing relative imports along the way. Keep file contents identical aside from path adjustments.
3. Update `packages/sql-query/src` files (`sql.ts`, `orm-builder.ts`, tests) to import from the new package. Handle circular dependencies (if any) by exporting helper types/functions through `sql-relational-core`.
4. Relocate tests + fixtures. Ensure the new package’s vitest config runs its own suite. Update root test commands if necessary.
5. Update workspace + tsconfig references/path aliases.
6. Run lint/typecheck/test commands (see below) until green. Fix any import violations flagged by `pnpm lint:deps`.

### Testing / Verification
- `pnpm --filter @prisma-next/sql-relational-core test`
- `pnpm --filter @prisma-next/sql-relational-core typecheck`
- `pnpm --filter @prisma-next/sql-query test`
- `pnpm lint`, `pnpm lint:deps`

### Notes
- Keep the existing operation-registry logic untouched; only its location changes. Slice 5 will introduce the target-neutral operations core.
- Add TODO comments in modules that still depend on runtime context types, noting that Slice 6 will clean those up.
