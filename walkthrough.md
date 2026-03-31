closes [TML-2166](https://linear.app/prisma-company/issue/TML-2166)

## Intent

Consolidate three overlapping SQL query lane packages (`sql-lane`, `kysely-lane`, `sql-builder-new`) into a single `@prisma-next/sql-builder` package. This simplifies the package graph and removes ~20k lines of duplicated DSL code. The SQL layer now has two query authoring surfaces: `sql-builder` for direct SQL queries and `orm` for the repository pattern.

## Change map

### 1. Package rename (`sql-builder-new` → `sql-builder`)

The directory `packages/2-sql/4-lanes/sql-builder-new` is renamed to `sql-builder`, the npm package name updated to `@prisma-next/sql-builder`, and `tsconfig.base.json` path references updated. No behavioral changes — pure rename.

### 2. Postgres extension rewired to sql-builder

[postgres.ts](packages/3-extensions/postgres/src/runtime/postgres.ts) — `PostgresClient.sql` now returns a sql-builder `Db<TContract>` proxy instead of sql-lane's `SelectBuilder`. The proxy is lazy-initialized (triggers runtime creation on first access). The `.kysely` property and `KyselyQueryLane` re-export are removed.

[runtime.ts (export)](packages/3-extensions/postgres/src/exports/runtime.ts) — `KyselyQueryLane` type export removed.

### 3. Demo migrated to sql-builder API

All query files in `examples/prisma-next-demo/src/queries/` rewritten from:
```
db.sql.from(table).select({col: table.columns.col}).build()  →  runtime.execute(plan)
```
to:
```
db.sql.table.select('col1', 'col2').all()  /  .first()
```

Removed: kysely folder (9 files), includeMany queries (2 files), no-emit queries (3 files + entry point), similarity search (blocked by missing `queryOperationTypes` in emitted contract), sql-lane type tests (3 files), kysely parity test.

### 4. E2E tests migrated

[utils.ts](test/e2e/framework/test/utils.ts) — `withTestRuntime` helper now provides a `db: Db<TContract>` instance alongside the existing `context`/`runtime`/`tables`. Added `collect()` helper.

Rewrote: `runtime.basic.test.ts`, `runtime.joins.test.ts`, `dml.test.ts` to use sql-builder's API. Removed: `runtime.includes.test.ts` (includeMany), `runtime.projections.test.ts` (sql-lane nested projections), `plan-types.test-d.ts` (sql-lane plan type inference).

### 5. Packages deleted

`packages/2-sql/4-lanes/sql-lane` and `packages/2-sql/4-lanes/kysely-lane` deleted entirely. All consumer `package.json` files updated to remove these dependencies. 10 integration test files that directly imported sql-lane removed (these tested sql-lane-specific plan metadata/AST inspection — equivalent coverage exists in sql-builder's 115-test suite).

### 6. Eslint plugin updated

[utils.ts](packages/1-framework/3-tooling/eslint-plugin/src/utils.ts) — `PRISMA_NEXT_SQL_PACKAGES` constant updated from `sql-lane` to `sql-builder`. Test fixtures updated to import from `@prisma-next/sql-builder`.

## Behavior changes & evidence

| Change | Evidence |
|--------|----------|
| `db.sql` returns `Db<Contract>` proxy (not `SelectBuilder`) | [postgres.ts](packages/3-extensions/postgres/src/runtime/postgres.ts) — getter triggers lazy runtime init |
| `db.sql` access triggers runtime creation | [postgres.test.ts](packages/3-extensions/postgres/test/postgres.test.ts) — test updated to verify lazy init |
| No `.kysely` on `PostgresClient` | [postgres.ts](packages/3-extensions/postgres/src/runtime/postgres.ts) — property removed from interface and return object |
| Demo queries no longer accept `runtime` parameter | [get-users.ts](examples/prisma-next-demo/src/queries/get-users.ts), [main.ts](examples/prisma-next-demo/src/main.ts) — calls updated |

## Compatibility / migration / risk

- **Breaking**: `PostgresClient.sql` type changes from `SelectBuilder` to `Db<Contract>`. Consumers must update from `.from(table).select({...}).build()` to `.table.select('col').all()`.
- **Breaking**: `PostgresClient.kysely` removed entirely.
- **Breaking**: `@prisma-next/sql-lane` and `@prisma-next/sql-kysely-lane` no longer exist as packages.

## Follow-ups / open questions

- **operationRegistry removal** deferred — deeply integrated into 48 files across runtime, emitter, and control-plane infrastructure. Tracked separately.
- **2 eslint-plugin test failures** — the plugin needs updates to understand sql-builder's different API patterns (no `.from().build()` chain).
- **Contract emitter** doesn't emit `queryOperationTypes` in TypeMaps — blocks extension function type safety (e.g., `cosineDistance`) in emitted contracts.
- **`returning` capability namespace** — contract places it under `postgres.returning` but sql-builder gates on `sql.returning`. Needs alignment.

## Non-goals / intentionally out of scope

- Adding new features to sql-builder (raw SQL, `.build()` plan inspection)
- Changing the `queryOperationRegistry` API
- Modifying the ORM lane or query-builder lane
- Updating documentation references to sql-lane in `docs/` and `ARCHITECTURE.md`
