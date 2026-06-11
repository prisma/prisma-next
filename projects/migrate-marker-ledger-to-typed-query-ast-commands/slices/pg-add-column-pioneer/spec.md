# Slice 7 — `pg-add-column-pioneer` (spec)

**Project:** migrate-marker-ledger-to-typed-query-ast-commands · **Phase:** 1 (prove planner adoption across all three targets) · **Linear:** _create at pickup_

## Purpose

Make the Postgres migration planner build `ALTER TABLE … ADD COLUMN …` as a **target-contributed typed DDL AST node** lowered through the control adapter, replacing the raw-SQL `addColumn()` op factory. This is the **ALTER TABLE pioneer** — `CREATE TABLE`/`CREATE SCHEMA` are already adopted (slice 4); ALTER TABLE is a fundamentally different shape (mutates an existing object, and is the root of ~10 more PG subactions in Phase 2). AddColumn is the simplest ALTER TABLE op (single action, no table-level constraint sub-clauses), so it settles the node-shape decision at the lowest risk.

## At a glance

```ts
// before — AddColumnCall.toOp() (sync, no lowerer) → raw-SQL op factory
toOp(): Op { return addColumn(this.schemaName, this.tableName, this.column); }
//   addColumn() concatenates: ALTER TABLE "s"."t" ADD COLUMN "c" <typeSql> <defaultSql> [NOT NULL]

// after — builds the typed node, lowers through the adapter (mirrors CreateTableCall)
async toOp(lowerer): Op {
  const ddlNode = contractFreeDdl.addColumn({ schema, table, column /* DdlColumn */ });
  const { sql, params } = await lowerer.lowerToExecuteRequest(ddlNode);
  return { …, execute: [step('add column', sql, params)], precheck/postcheck: columnExistsCheck(…) };
}
```

The emitted SQL is **byte-identical** to today's; the change is *how it's constructed* — a frozen-class node lowered by the adapter walker, not a string glued in the op factory.

## The load-bearing decision (settled by the dispatch-1 spike, not here)

The **ALTER TABLE node shape**:
- **Option A — separate node kinds per subaction** (`PostgresAlterTableAddColumn`, later `…DropColumn`, `…AlterColumnType`, …). One frozen `PostgresDdlNode` subclass + one `PostgresDdlVisitor` method + one adapter-walker arm each. Mirrors the existing flat-per-action IR (the `*Call` union, `PostgresDdlVisitor`, and the Mongo DDL command union are all flat-per-action).
- **Option B — one polymorphic `PostgresAlterTable` carrying a discriminated subaction list.** Models multi-subaction `ALTER TABLE t ADD …, DROP …` as one statement; renders the `ALTER TABLE <table>` prefix once. But the planner emits **one subaction per Op** with its own precheck/postcheck, so the batching has no consumer today.

Grounding read (see `dispatches/01-…`): **Option A** fits the codebase as it stands; record **B** as the migration target *if/when* the planner learns to coalesce subactions. The spike confirms or overturns this and also settles two coupled questions:
1. **Carrier:** `AddColumnCall` should carry a **`DdlColumn`**, not the pre-rendered `ColumnSpec.defaultSql` string — so codec-encoded defaults flow through the adapter's `pgRenderDdlColumnDefault`/`codecRef` path (same as CreateTable), not a bypassed legacy string.
2. **Walker dispatch:** the adapter lowerer dispatches on `ast.kind` (`pgRenderDdlExecuteRequest`), not via `accept(PostgresDdlVisitor)` — so a new node kind is *not* compiler-exhaustiveness-checked in the walker. The spike decides whether to convert the walker to a real visitor now (cheapest at 2→3 kinds).

## Non-goals

- **AddColumn only.** The other ~10 PG ALTER TABLE subactions (`DropColumn`, `AlterColumnType`, `SetNotNull`/`DropNotNull`, `SetDefault`/`DropDefault`, the constraint ALTERs) are Phase 2 — they reuse the shape this slice settles.
- **Leave the second raw-SQL emitter in place.** `buildAddColumnSql` (`planner-ddl-builders.ts`) feeds only the not-null-with-temporary-default recipe (`planner-recipes.ts`); migrating that recipe is out of scope. Flag it as a follow-up so two `ALTER TABLE … ADD COLUMN` emitters don't silently diverge — byte-parity tests must cover the new path.
- **No planner subaction-coalescing.** One subaction per Op stays; this slice doesn't teach the planner to batch.
- **No SQLite/Mongo AddColumn.** PG only (the ALTER-shape pioneer); other targets are their own Phase-2/pioneer work.

## Cross-cutting requirements

- **Byte-parity.** The lowered `ALTER TABLE … ADD COLUMN …` SQL is byte-identical to the current `addColumn()` output for every column shape (type, default literal/function/codec, nullability). Pinned by a new byte-parity oracle test mirroring `ddl-create-table-lowering.test.ts`. `pnpm fixtures:check` stays clean.
- **One construction + one lowering path.** AddColumn is built via the contract-free constructor and lowered via `adapter.lowerToExecuteRequest` — no raw SQL glued in `AddColumnCall.toOp()`.
- **Codec-correct defaults.** Carrying `DdlColumn` routes defaults through the adapter's existing codec-encode path; the legacy pre-rendered `defaultSql` string is not used by the new node.
- **Green main between slices** (CI green; no sibling-merge dependency).

## Definition of Done

- [ ] Team-DoD floor (repo gates, docs/migration, Linear close-out).
- [ ] A target-contributed ALTER-TABLE-ADD-COLUMN DDL node exists (shape per the spike), built by a contract-free constructor, lowered by the Postgres adapter walker.
- [ ] `AddColumnCall.toOp()` is async + lowerer-driven (mirrors `CreateTableCall.toOp`), builds the node, and wires the lowered SQL + the `columnExistsCheck` precheck/postcheck into the Op; the old `addColumn()` op factory is no longer called (and is removed if now dead, except where the recipe path still needs it — scoped above).
- [ ] Byte-parity oracle test for the AddColumn lowering; the all-`*Call` lowering smoke test updated for the now-async AddColumn.
- [ ] The node-shape decision (A vs B), the `DdlColumn` carrier choice, and the walker-visitor decision are recorded in the project design-notes.

## Open questions (resolved by the spike, recorded in dispatches/01)

1. Node shape: Option A (separate kinds) vs B (polymorphic + subaction list).
2. Should `pgRenderDdlExecuteRequest` become a real `accept`-based visitor now (2→3 kinds), for compiler-checked exhaustiveness?
3. `primaryKey: true` on a `DdlColumn` in ADD COLUMN — forbid or pass through? (Planner doesn't set it today.)
