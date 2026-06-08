# Slice: sqlite-create-table-adoption

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome it contributes: the planner-adoption pattern proven for SQLite — the second SQL dialect mirrors what slice 4 [TML-2754] shipped for Postgres, closing the Phase 1 SQLite leg of the project's "all three targets" DoD clause.)_

## At a glance

Make SQLite's `CreateTableCall.toOp()` build a `SqliteCreateTable` DDL-AST node via the contract-free `createTable(...)` constructor and lower it through `SqlControlAdapter.lower()`, replacing the call to `renderCreateTableSql` string concatenation on the planner's live path. To wire that up, the slice plumbs the `Lowerer` through the SQLite planner stack (`createSqliteMigrationPlanner` → planner field → `renderOps` → `*Call.toOp(lowerer?)`), exactly mirroring the threading slice 4 added to the Postgres stack — all the substrate (`SqliteCreateTable` node, SQLite adapter constraint-rendering with 4 byte-parity tests, `SqliteMigration` base) is already in place, so this is a pattern-mirror, not a design slice.

## Chosen design

This slice mirrors slice 4's Postgres pattern; it does not re-litigate any design decisions slice 4 settled (constraint-node shape, contract-free constructor surface, `Lowerer` interface, step-contract `sql: string`). The chosen design is "do exactly what PG did, on SQLite, with the same surfaces."

### Lowerer plumbing (mirror of slice 4 on the SQLite side)

```
before:                                                  after:
createSqliteMigrationPlanner()                           createSqliteMigrationPlanner(lowerer: Lowerer)
  → new SqliteMigrationPlanner()                           → new SqliteMigrationPlanner(lowerer)
                                                             ↳ holds readonly #lowerer

SqliteMigrationPlanner.plan(...)                         SqliteMigrationPlanner.plan(...)
  → new TypeScriptRenderableSqliteMigration(calls, ...)    → new TypeScriptRenderableSqliteMigration(calls, ..., this.#lowerer)

TypeScriptRenderableSqliteMigration.operations           TypeScriptRenderableSqliteMigration.operations
  → renderOps(this.#calls)                                 → renderOps(this.#calls, this.#lowerer)

renderOps(calls)                                         renderOps(calls, lowerer?)
  → calls.map(c => c.toOp())                               → calls.map(c => c.toOp(lowerer))

abstract toOp(): Op                                      abstract toOp(lowerer?: Lowerer): Op
```

`SqliteControlTargetDescriptor.createPlanner(adapter)` (currently `_adapter`, line 39 / 70 of `control-target.ts`) starts threading the adapter through: `createSqliteMigrationPlanner(adapter)`. The `SqlControlAdapter` structurally satisfies `Lowerer`, so this is one identifier change per call site.

### `CreateTableCall.toOp()` migration (the actual op-level change)

```ts
// before — packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts:67
toOp(): Op {
  return createTable(this.tableName, this.spec);   // calls renderCreateTableSql under the hood
}

// after
toOp(lowerer?: Lowerer): Op {
  if (lowerer === undefined) {
    throw new Error(
      `CreateTableCall.toOp: a DDL lowerer is required on the SQLite planner path (table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
    );
  }
  const node = contractFreeDdl.createTable({
    table: this.tableName,
    columns: /* mapped from this.spec */,
    ...(constraints ? { constraints } : {}),
    ...(ifNotExists ? { ifNotExists } : {}),
  });
  const { sql } = lowerer.lower(node, { contract: {} });
  return { id: `table.${this.tableName}`, label: this.label, operationClass: this.operationClass,
           execute: [{ description: `create table "${this.tableName}"`, sql }],
           target: { id: 'sqlite', details: { objectType: 'table', name: this.tableName } } };
}
```

The mapping `SqliteTableSpec → { columns, constraints }` reuses the existing planner-side type-resolution that fed `renderCreateTableSql`; only the SQL-assembly step is replaced. **Native-type resolution and codec-hook expansion stay planner-side** (same boundary slice 4 settled for PG).

### `SqliteMigration` gains a `createTable({...})` method (authoring-surface symmetry with PG)

Slice 4 made PG's `Migration.createTable({...})` a method that lowers a typed DDL node through the adapter; the free `createTable(...)` was dropped from `@prisma-next/postgres/migration`. SQLite follows the same shape for symmetry — user-edited `migration.ts` files use `this.createTable({...})`. The free `createTable` re-export comes off `@prisma-next/sqlite/migration` in this slice.

`SqliteMigration.dropTable(...)` / `recreateTable(...)` / `addColumn(...)` / etc. stay as free re-exports — those ops are Phase 2.

## Coherence rationale

One reviewer holds it because it is a single mechanism with a single consumer, mirrored from a proven pattern: "the SQLite planner's `CREATE TABLE` now goes through the DDL AST, the same way PG's does." The Lowerer-plumbing through the SQLite planner stack and the `CreateTableCall.toOp()` migration are inseparable — the threading is unused without the consumer that migrates, and the consumer can't migrate until the threading exists. Splitting them would either ship unused planner infrastructure or a half-migrated op.

The `SqliteMigration.createTable({...})` method + the free-export removal also belong in this slice: keeping the free export while the planner stops producing string-glued SQL would leave an inconsistent authoring surface for one release; the user-facing API change is part of "the planner-adoption pattern for SQLite" and shouldn't ship in a separate sliver-PR.

## Scope

**In:**
- Plumb `Lowerer` through the SQLite planner stack (`createSqliteMigrationPlanner` → `SqliteMigrationPlanner.#lowerer` → `TypeScriptRenderableSqliteMigration` constructor → `renderOps(calls, lowerer?)` → abstract `SqliteOpFactoryCallNode.toOp(lowerer?: Lowerer): Op`). Mirror of slice 4 on the SQLite side.
- Update `SqliteControlTargetDescriptor.createPlanner(adapter)` (both call sites — the `migrations.createPlanner` and the `@deprecated` direct method) to pass `adapter` to `createSqliteMigrationPlanner(adapter)`. Rename the `_adapter` param to `adapter`.
- Migrate **SQLite `CreateTableCall.toOp()`** to build the DDL node via the contract-free `createTable(...)` constructor and lower through `lowerer.lower(...)`. Throw a clear error when called without a lowerer (the planner-path invariant), mirroring the PG `CreateTableCall.toOp()` error shape.
- Add `SqliteMigration.createTable({ table, columns, constraints?, ifNotExists? })` method that builds the DDL node + lowers through the adapter, symmetric with `PostgresMigration.createTable(...)`.
- Drop the free `createTable` re-export from `packages/3-targets/3-targets/sqlite/src/exports/migration.ts`. Update `packages/3-extensions/sqlite/test/migration/re-export.test.ts` if a corresponding assertion exists (mirror what slice 4's commit `0d09f8b0b` did for the PG facade).
- A unit test that drives `SqliteCreateTableCall.toOp(lowerer)` end-to-end through the lower path and asserts the rendered SQLite `CREATE TABLE` SQL is **byte-identical to pre-slice-5 planner output** (adapter-level rendering tests are not sufficient — the proof must exercise `toOp(lowerer)`).

**Out (deliberately left for Phase 2 slices or later):**
- All other SQLite `*Call` migrations (`DropTable`, `AddColumn`, `DropColumn`, `RecreateTable`, `CreateIndex`, `DropIndex`, `RawSql`, `DataTransform`). Their `toOp(lowerer?)` continues to ignore the optional `lowerer` arg; they keep calling the free Op-builders. **Phase 2.**
- `renderCreateTableSql` itself (line 22 of `operations/tables.ts`) **stays**, because `recreateTable(...)` at line 171 still calls it. Migration of `RecreateTable` to the lower path — and the eventual deletion of `renderCreateTableSql` — is **Phase 2**.
- The free `createTable` Op-builder at `operations/tables.ts:45` **stays** (no production call site after this slice, but it's harmless and its removal becomes part of the `operations/tables.ts` end-state cleanup once all SQLite ops migrate — project DoD demolition list).
- Cross-cutting `SELECT to_regclass(...)`-style precheck/postcheck migration — **Phase 2** (own slice across all ops).
- Postgres changes — already shipped in slice 4 / #751.
- TS-migration render path (`renderTypeScript()`) for SQLite — unchanged.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `renderCreateTableSql` is shared between `createTable` (planner free-builder) and `recreateTable` (Phase 2) | Function stays in place; only the `CreateTableCall.toOp()` code path stops calling it | `recreateTable` at `operations/tables.ts:171` still needs raw-SQL output for the temp-table dance until its Phase 2 slice migrates. `git grep renderCreateTableSql` after this slice should return one production caller (`recreateTable`) plus the function itself, no other live consumers. |
| SQLite-specific `CREATE TABLE` quirks (`INTEGER PRIMARY KEY AUTOINCREMENT` inline, `autoincrement()` default, `now()` → `datetime('now')`) | Already covered by 4 existing byte-parity tests at `packages/3-targets/6-adapters/sqlite/test/ddl-table-constraints-lowering.test.ts` | The adapter visitor already renders these correctly. The slice's byte-parity test extends coverage by exercising the `*Call.toOp(lower)` path end-to-end. |
| Free `createTable` is a public re-export from `@prisma-next/sqlite/migration` | Removed in this slice (breaking-API change for SQLite migration.ts authors); mirrors PG slice 4 | Slice 4 set the precedent; the new authoring form is `this.createTable({...})` on the `SqliteMigration` base class. Recorded in `record-upgrade-instructions` at PR-write time so downstream consumers get a migration. |
| `SqliteOpFactoryCallNode.toOp(): Op` abstract signature change | All 9 SQLite `*Call` subclasses must update `toOp()` → `toOp(lowerer?: Lowerer): Op` to satisfy the new abstract | Mechanical — every subclass except `CreateTableCall` ignores the new optional arg. Compiler-checked. |

## Slice-specific done conditions

- [ ] SQLite `CreateTableCall.toOp(lowerer)` produces its `execute` step `sql` via `adapter.lower()` of a `SqliteCreateTable` DDL node, with **no string-build fallback** (the planner tests pass a real lowerer and exercise the lower path); `git grep "createTable(this.tableName, this.spec)"` returns zero matches in `op-factory-call.ts`.
- [ ] Rendered SQLite `CREATE TABLE` is **byte-identical to pre-slice-5 output, pinned by a test that drives `CreateTableCall.toOp(lowerer)`** (not just adapter-level rendering); migration golden/snapshot tests green with no regeneration; `pnpm fixtures:check` green.
- [ ] The free `createTable` export comes off `@prisma-next/sqlite/migration`; the corresponding facade re-export test is updated (mirror of slice 4's commit `0d09f8b0b`).

## Adapter-impact (repo-specific section per `drive/spec/README.md`)

- **SQLite adapter (`@prisma-next/adapter-sqlite`):** No change. The adapter-side substrate (the `renderLoweredDdl` lower path, the `SqliteCreateTable`-visitor case, the PK/FK/Unique constraint rendering) already exists from slices 1 and 4. The slice extends coverage by adding an end-to-end test that drives the planner's `*Call.toOp(lowerer)` (the existing `ddl-table-constraints-lowering` tests cover the adapter directly).
- **Postgres adapter:** Unchanged (slice 4 already shipped its adoption).
- **Mongo adapter:** Unchanged (slice 6 — separate Phase 1 pioneer).

## ADR pointer

This slice does not introduce a new architectural shift; it adopts the "DDL as a target-contributed query-AST kind + adapter DDL-lowering seam" pattern on the SQLite side. The project-wide ADR for that pattern is queued for the project's close-out (project DoD line 71), to be authored when all three targets have adopted.

## Open Questions

1. **The `SqliteTableSpec → { columns, constraints }` mapping.** `SqliteTableSpec` is the existing planner-side shape; the contract-free `createTable({ columns, constraints? })` constructor takes the slice-1/4 substrate shape. The mapping is mechanical (each `SqliteColumnSpec` → `col(name, type, opts)`; `spec.primaryKey?.columns` → `primaryKey([...cols])` constraint if composite, else inline column option; FKs / unique → constraint array). Working position: write the mapping inline inside `CreateTableCall.toOp()`. Settled by dispatch 1 (a small in-slice spike that pins the mapping + lands the byte-parity test); no need for a `design-notes.md` entry unless something non-obvious surfaces.
2. **Whether to also rename the `_adapter` param to `adapter` in the SQLite descriptor's `createPlanner(_adapter)` call sites in the same slice.** Working position: yes — touching them anyway to thread the adapter, and `_adapter` is the "unused" marker which no longer applies.

## References

- Parent project: [`projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`](../../spec.md) — Phase 1 "all three targets" DoD clause.
- Project plan: [`projects/migrate-marker-ledger-to-typed-query-ast-commands/plan.md`](../../plan.md) — Slice 5 entry.
- Builds on (merged):
  - Slice 1 — `ddl-in-query-ast` ([TML-2761](https://linear.app/prisma-company/issue/TML-2761)) — DDL AST + visitor seam + SQLite contract-free constructors.
  - Slice 4 — `planner-create-table-adopts-ddl-ast` ([TML-2754](https://linear.app/prisma-company/issue/TML-2754), merged in PR #751) — proven Postgres pattern + the constraint substrate (PK/FK/Unique nodes + SQLite adapter constraint-rendering).
- Surfaces this slice touches (grounded by Read/Grep at spec time):
  - SQLite planner: `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts`, `planner-produced-sqlite-migration.ts`, `render-ops.ts`, `op-factory-call.ts`.
  - SQLite descriptor: `packages/3-targets/3-targets/sqlite/src/core/control-target.ts`.
  - SQLite migration class: `packages/3-targets/3-targets/sqlite/src/core/migrations/sqlite-migration.ts`.
  - SQLite migration facade: `packages/3-targets/3-targets/sqlite/src/exports/migration.ts` + `packages/3-extensions/sqlite/test/migration/re-export.test.ts` (if present).
  - SQLite adapter substrate (read-only — already complete): `packages/3-targets/6-adapters/sqlite/src/core/{adapter,ddl-renderer}.ts`, `packages/3-targets/6-adapters/sqlite/test/ddl-table-constraints-lowering.test.ts`.
- Slice 4 spec for the pattern this mirrors: [`projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/planner-create-table-adopts-ddl-ast/spec.md`](../planner-create-table-adopts-ddl-ast/spec.md).
- Linear issue: [TML-2859](https://linear.app/prisma-company/issue/TML-2859).
