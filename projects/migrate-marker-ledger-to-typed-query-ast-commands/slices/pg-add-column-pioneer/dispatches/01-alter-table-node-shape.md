# D1 (spike) — ALTER TABLE node shape: decision (operator-settled)

Settles the load-bearing decision before D2. Grounded in a read of the existing DDL IR; the four calls were settled with the operator.

## Guiding principle (operator)
**AST nodes model the SQL grammar as closely as possible.** A node that fuses a statement with one of its actions (e.g. `PostgresAlterTableAddColumn`) is a brittle fudge — it isn't how the grammar works.

## Decision 1 — node shape: **Option B (faithful `AlterTable` + action list)**
The Postgres grammar is `ALTER TABLE <name> <action> [, <action> …]`. Model it directly:
- `PostgresAlterTable` — a frozen `PostgresDdlNode` (`kind: 'alter-table'`) carrying `schema`, `table`, and `actions: readonly AlterTableAction[]`.
- `AlterTableAction` — a **second frozen-class polymorphic hierarchy** (its own base + variants + visitor), with `AddColumnAction` (carrying a `DdlColumn`) as the only variant in this slice. Phase-2 subactions (`DropColumnAction`, `AlterColumnTypeAction`, `SetNotNullAction`, constraint actions, …) join the union later.
- A single add is `PostgresAlterTable { actions: [AddColumnAction(col)] }`.

Precedent for a nested polymorphic value-hierarchy inside a node: `DdlColumnDefault`/`DdlColumnDefaultVisitor` and `DdlTableConstraint` (both `ddl-types.ts`). `AlterTableAction` follows that shape.

(The earlier "Option A, no consumer for batching" reasoning is dropped — under the model-the-grammar principle, whether the planner ever emits multiple actions is irrelevant; the node models the statement regardless.)

## Decision 2 — dispatch: **`accept()` visitor, compiler-checked, both layers**
Adopt the codebase's frozen-class/visitor pattern instead of hand-written `.kind` switches:
- **Action list:** `AlterTableActionVisitor` with one method per action; the adapter renders actions via `action.accept(visitor)`. The compiler forces every action variant to be handled.
- **Top-level DDL:** convert the adapter's `pgRenderDdlExecuteRequest` `.kind` switch (currently `create-table`/`create-schema`) to `node.accept(PostgresDdlVisitor)` dispatch as part of this slice — cheapest while the kind set is small (2→3), and the action-list dispatch already needs the visitor, so do both together. Gains compiler-checked exhaustiveness for all future DDL kinds.

## Decision 3 — carrier: **structured `DdlColumn`**
`AddColumnAction` carries a `DdlColumn` (name + native type + structured default + nullability + optional `codecRef`), NOT a pre-rendered `ColumnSpec.defaultSql` string. The adapter renders the column via the existing `pgRenderDdlColumn` → `pgRenderDdlColumnDefault`, so codec-encoded defaults flow through the same (async, correct) path as CreateTable. D2 touches the planner construction site (`issue-planner.ts` `toColumnSpec` → build a `DdlColumn`).

## Decision 4 — `primaryKey` on an ADD COLUMN column: non-issue
The planner never sets `primaryKey` when adding a column (a PK is a separate action). Pass the `DdlColumn` through unchanged; add a test pinning the invariant. No runtime guard.

## Hand-off to D2 (implement Option B + visitor)
- `PostgresAlterTable` node + `AlterTableAction` hierarchy (`AddColumnAction`) + `AlterTableActionVisitor` — `postgres/src/core/ddl/nodes.ts`.
- Convert `pgRenderDdlExecuteRequest` to `accept`-based `PostgresDdlVisitor` dispatch; add the `alterTable` visitor method; render actions via the action visitor (reuse `pgRenderDdlColumn` for the column fragment) — `6-adapters/postgres/.../control-adapter.ts`.
- Contract-free constructor `contractFreeDdl.alterTable({ schema, table, actions: [addColumnAction(col)] })` (+ an `addColumnAction(col: DdlColumn)` helper) — `postgres/src/contract-free/ddl.ts`.
- Async lowerer-driven `AddColumnCall.toOp` building `AlterTable { actions: [AddColumnAction] }`; lift the `columnExistsCheck` precheck/postcheck framing into `toOp` — `op-factory-call.ts` (+ `issue-planner.ts` carrier, exports barrels).
- Tests-first: byte-parity oracle `ddl-add-column-lowering.test.ts`; update the all-`*Call` lowering smoke test (AddColumn now async); the `primaryKey`-invariant test.
- Leave `buildAddColumnSql` + the temp-default recipe (out of scope; byte-parity guards divergence).
