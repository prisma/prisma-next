## Slice 4 — Split SQL Lanes

### Context
- After Slice 3, relational primitives live in `@prisma-next/sql-relational-core`, but the SQL DSL + ORM builder still share a single `@prisma-next/sql-query` package.
- We want separate lane packages: `@prisma-next/sql-lane` (relational DSL + raw) and `@prisma-next/sql-orm-lane` (ORM builder + helpers) so future targets can consume the DSL independently.

### Goals
1. Move `sql.ts`, raw lane helpers, AST lowering utilities, and related tests into `packages/sql/lanes/sql-lane`.
2. Move `orm-builder.ts`, `orm-types.ts`, include/relations helpers, and ORM-specific tests into `packages/sql/lanes/orm-lane`.
3. Keep existing public exports (e.g., `@prisma-next/sql-query/sql`) by re-exporting from the new packages during migration.
4. Ensure each lane depends only on `@prisma-next/sql-relational-core` + target contracts, not on each other.
5. Update docs/tests/examples to import from the new packages when possible (with transitional shims where necessary until Slice 7).

### Non-goals
- Removing the `@prisma-next/sql-query` facade (Slice 7).
- Refactoring ORM internals beyond moving files (performance/feature work is out of scope).
- Changing runtime adapters or plan factories.

### Deliverables
- `@prisma-next/sql-lane` and `@prisma-next/sql-orm-lane` packages with build/test configs.
- Transitional re-export module(s) inside `@prisma-next/sql-query` to avoid breaking existing imports.
- Updated examples/tests referencing the new packages (or the bridge) where appropriate.

### Step Outline
1. Move DSL files into `sql-lane`, update package exports + path aliases.
2. Move ORM files into `orm-lane`, update imports.
3. Ensure tests run per package; update fixtures accordingly.
4. Provide re-export modules (with TODO comments) for backwards compatibility.

### Testing / Verification
- `pnpm --filter @prisma-next/sql-lane test`
- `pnpm --filter @prisma-next/sql-orm-lane test`
- `pnpm --filter @prisma-next/sql-query test`
- Scenario tests in `examples/` still pass (especially ORM integration tests).

### Notes
- Keep build outputs tree-shakeable; only export curated entry points.
- Document remaining references to `@prisma-next/sql-query` so Slice 7 knows what to remove.
