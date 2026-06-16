# D1 — implement both fixes

## What landed

- **Op-id namespacing** (`91dc9fa8d`). `AddColumnCall.toOp` op id changed from `column.${tableName}.${columnName}` to `column.${schemaName}.${tableName}.${columnName}` — schema injected between the `column.` prefix and the table name. Cross-schema uniqueness test added in `op-factory-call.construction.test.ts`. Test assertions on op-id literals updated in `op-factory-call.lowering.test.ts`, `planner.fk-config.test.ts`, and pgvector planner tests.
- **`codecRef` round-trip** (`ecd298872`). `renderDdlColumnAsTsCall` now emits `codecRef: { ... }` in the `col()` call when present. Three new tests in `op-factory-call.rendering.test.ts` pinning the rendered shape + round-trip identity.

## Sibling defect — out of scope (follow-up)

NOT NULL columns without defaults take a different code path: `AddNotNullColumnDirectCall` → `buildAddColumnOperationIdentity` in `planner-recipes.ts`, which still produces the **old** `column.${tableName}.${columnName}` format. Same correctness defect, different site. Per the plan, this slice did not widen to fix it; the pgvector planner-behavior test helper was updated to **dynamically** select the correct op-id format based on whether the column is nullable / has a default — that ensures tests pass under both formats during the transition, but the underlying bug at the `planner-recipes.ts` site remains.

**Follow-up:** namespace the op id produced by `buildAddColumnOperationIdentity` in `planner-recipes.ts` so all column-add paths converge on `column.${schema}.${table}.${column}`. Small, scoped, separate PR; once landed, the dynamic helper in the pgvector test can revert to a literal assertion.

## CodecRef render shape

Rendered via `jsonToTsSource(col.codecRef)` (the same form already used in this function for `col.name` / `col.type`). `CodecRef` is `{ codecId: string, typeParams?: ... }` — JSON-renderable, no exotic fields encountered in the tests. The `col()` factory accepts it via `DdlColumnOptions` spread, so the re-parsed `DdlColumn` round-trips identically.

## Gates (targeted)

`pnpm typecheck` clean; `pnpm --filter @prisma-next/target-postgres test`, `@prisma-next/adapter-postgres test`, `@prisma-next/sql-relational-core test`, pgvector planner tests — all green. Linters clean. Heavy `test:packages` / `test:integration` deferred to the orchestrator.
