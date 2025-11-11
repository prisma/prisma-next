## SQL Lanes Phase 1 — Shared AST Factories & Internal Refactor (Domain: SQL, Layer: lanes, Plane: runtime)

### Context
- Slice 4 requires `@prisma-next/sql-orm-lane` and `@prisma-next/sql-lane` to depend only on `@prisma-next/sql-relational-core`, but ORM still imports `sql()` and `createJoinOnBuilder()` from the SQL lane.
- Both lanes currently construct SQL AST nodes inline, so ORM reached for the DSL as the easiest way to generate AST.
- We want to keep public APIs unchanged for now while moving AST construction logic into `sql-relational-core` so both lanes share the same factories and can evolve independently.

### Goals
1. Introduce AST factory helpers inside `@prisma-next/sql-relational-core` for every SQL statement/node we emit today (select, insert, update, delete, joins, predicates, order-by, raw expressions, etc.). These factories must be structural only—no capability checks, no adapter awareness.
2. Refactor `@prisma-next/sql-lane` to consume the new factories internally. We can split the current monolithic files for maintainability, but the public API (`sql`, `schema`, `param`, raw helpers) must remain identical in Phase 1.
3. Refactor `@prisma-next/sql-orm-lane` to consume the same factories and remove all imports from `@prisma-next/sql-lane`. ORM's public API also remains unchanged in Phase 1.
4. Keep the dependency guard (`pnpm lint:deps`) green by removing the temporary allowance for ORM→SQL lane once the refactor is complete.

### Non-goals
- Changing public APIs for either lane (that is Phase 2 work).
- Adding capability-aware validation to the factories. Capability gating remains the responsibility of lanes and runtime/adapters.
- Removing `@prisma-next/sql-query` or other legacy packages.

### Step Outline
1. Scaffold AST factory modules under `packages/sql/lanes/relational-core/src` (e.g., `ast/select.ts`, `ast/join.ts`, etc.) and port the existing AST construction logic from `sql-lane` into these helpers.
2. Update `@prisma-next/sql-lane` internals to use the new factories, splitting large files as needed, but preserving the public exports.
3. Update `@prisma-next/sql-orm-lane` internals to use the same factories, removing imports from `@prisma-next/sql-lane`.
4. Update `scripts/check-imports.mjs` (or its replacement) to fail if ORM imports from SQL lane.
5. Document the new factories in the `sql-relational-core` README (summary of available helpers and intended usage).

### Testing / Verification
- `pnpm --filter @prisma-next/sql-relational-core test`
- `pnpm --filter @prisma-next/sql-lane test`
- `pnpm --filter @prisma-next/sql-orm-lane test`
- Scenario/Example suites that rely on both lanes (e.g., `pnpm --filter examples/prisma-next-demo test`)
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Acceptance Criteria
- `@prisma-next/sql-orm-lane` no longer imports from `@prisma-next/sql-lane` (dependency guard enforces this).
- Both lanes build ASTs using factories defined in `@prisma-next/sql-relational-core`.
- All tests pass without modifying public APIs or downstream call sites.
- `sql-relational-core` documents the new factory helpers for future consumers.
