# Slice: planner-create-table-adopts-ddl-ast

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome: the migration planner's `CREATE TABLE`/`CREATE SCHEMA` stops concatenating SQL and shares the marker-bootstrap DDL-AST + lowering path — the first step of the planner-adoption phase.)_

## At a glance

Make the SQL migration planner's `CreateTableCall.toOp()` (Postgres + SQLite) and `CreateSchemaCall.toOp()` (Postgres) build the target-contributed DDL-AST nodes from slice `ddl-in-query-ast` (via the contract-free constructors) and lower them through `adapter.lower()`, replacing `buildCreateTableSql` / SQLite `renderCreateTableSql` string concatenation. To carry real user tables (not just the single-column marker table), this slice **extends the `CreateTable` DDL node with a target-contributed table-level constraint surface** (composite primary key, foreign keys, table-level unique) that marker bootstrap didn't need.

This is the **first** planner-adoption slice. It is deliberately scoped to `CREATE TABLE`/`CREATE SCHEMA` — the only DDL ops slice 1 shipped nodes for — and proves the planner-adoption pattern end-to-end. The remaining planner DDL op-families (and the Mongo migration planner) are tracked follow-ups (see **Scope → Out**).

## Chosen design

The planner already produces flat, resolved `*Call` IR whose `toOp()` returns a `SqlMigrationPlanOperation` with an `execute` step carrying `sql: string`. Today that string is concatenated by `planner-ddl-builders.ts`. This slice changes **how the `execute` step's `sql` is produced** for create-table/create-schema, nothing downstream:

```
before:  CreateTableCall.toOp() ─▶ execute: [step(desc, buildCreateTableSql(...))]      // raw string
after:   CreateTableCall.toOp() ─▶ node = createTable({ table, schema, columns, constraints })
                                   execute: [step(desc, adapter.lower(node, ctx).sql)]    // lowered AST
```

**The step contract is unchanged.** `SqlMigrationPlanOperationStep.sql: string` stays; we lower the node to `{ sql, params }` *inside* `toOp()` and put `.sql` on the step (first-pass scope, per the project plan). Runner, preview, and snapshots are untouched. `params` is empty for DDL (the planner inlines literals into native-type/default strings exactly as today).

**Node construction** uses the existing contract-free surface from slice 1: `createTable({ table, schema?, ifNotExists?, columns, constraints })` with `col(name, type, opts)`, `lit(value)`, `fn(expr)`. The planner keeps resolving the **native type string** (its `buildColumnTypeSql` codec-hook/storage-type resolution feeds `col(name, <resolved-type>, …)`); the adapter owns turning the node into SQL (quoting, placement, `DEFAULT`/`NOT NULL`/`PRIMARY KEY` rendering). The raw `buildCreateTableSql` (PG) / `renderCreateTableSql` (SQLite) SQL-assembly is removed; the type-resolution helper it called is retained as a node-construction input.

**Node-shape extension — table-level constraints (the load-bearing piece).** Slice 1's `CreateTable` node modelled only column-level `notNull`/`primaryKey`/`default` (all the marker table needed). Planner user-tables also carry **composite primary keys, foreign keys, and table-level unique constraints** (`buildCreateTableSql` assembles them as `allDefinitions = [...columns, ...constraints]`). So `CreateTable` gains a **target-contributed** `constraints` surface. Working position (settled by dispatch 1, mirroring how slice 1 settled its visitor API):

```ts
// relational-core: family-base constraint shapes (frozen)
type DdlTableConstraint =
  | PrimaryKeyConstraint   // { columns: string[], name?: string }
  | ForeignKeyConstraint   // { columns, refTable, refColumns, onDelete?, onUpdate?, name? }
  | UniqueConstraint;      // { columns: string[], name? }

interface CreateTable { /* …existing… */ readonly constraints?: readonly DdlTableConstraint[]; }
```

The adapter's DDL visitor renders each constraint in dialect SQL (PG `"…"` quoting + `REFERENCES`; SQLite inline forms). Targets contribute exactly what they support (SQLite expresses FKs/PK inline in `CREATE TABLE`; no standalone constraint DDL). The exact constraint vocabulary and whether FK actions are opaque strings vs a small enum is the dispatch-1 spike's call, recorded in `design-notes.md`.

## Coherence rationale

One reviewer holds it because it is a single mechanism with a single consumer: "the planner's `CREATE TABLE`/`CREATE SCHEMA` now goes through the DDL AST." The node-shape extension (table-level constraints) and the planner call-site migration are inseparable — the planner can't adopt `CreateTable` until the node can express the constraints real tables have, and the extension is pointless without the consumer that needs it. Splitting them would ship an unused node field or a half-migrated planner.

## Scope

**In:**
- Extend the `CreateTable` DDL node + the contract-free `createTable(...)` constructor (Postgres + SQLite) with a target-contributed table-level **constraint** surface (composite PK, FK, unique).
- Render the new constraints in the Postgres and SQLite adapter DDL visitors (dialect-correct).
- Migrate **Postgres** `CreateTableCall.toOp()` + `CreateSchemaCall.toOp()` to build the node via the constructors and lower it through the injected `SqlControlAdapter` interface at plan time (see `design-notes.md § Planner DDL lowering mechanism (D3) — RESOLVED`); the `execute` step `sql` comes from lowering, with **no string-build fallback path**. Remove the raw `buildCreateTableSql` (PG) SQL-assembly (retain native-type resolution as node input). _(SQLite planner migration is split to a follow-up slice — see Out; narrowed post-D3-review, operator-approved.)_
- A unit test that drives `CreateTableCall.toOp(lower)` / `CreateSchemaCall.toOp(lower)` **end-to-end through the lower path** and asserts the rendered Postgres `CREATE TABLE` (incl. composite PK) + `CREATE SCHEMA` is **byte-identical to pre-D3 planner output** (adapter-level rendering tests are not sufficient — the proof must exercise `toOp(lower)`). Migration golden/snapshot tests stay green with no regeneration.

**Out (tracked follow-up slices in this project — each adds the node(s) + adapter visitor case + planner adoption):**
- **Postgres column ops:** `AddColumn`, `DropColumn`, `AlterColumnType`, `SetNotNull`, `DropNotNull`, `SetDefault`, `DropDefault`.
- **Constraint ALTERs:** `AddPrimaryKey`, `AddUnique`, `AddForeignKey`, `DropConstraint`.
- **Indexes:** `CreateIndex`, `DropIndex` (both targets).
- **Postgres types/db:** `CreateEnumType`, `AddEnumValues`, `DropEnumType`, `RenameType`, `CreateExtension`.
- **`DropTable`** (both); **SQLite `RecreateTable`** (the table-rebuild dance — likely its own slice).
- **SQLite `CreateTable` planner adoption — split out of this slice** (post-D3-review, operator-approved: D3 proved hard as a two-dialect dispatch, so Postgres lands first per the plan's sanctioned Postgres-then-SQLite fan-out). The shared substrate already exists from D1/D2 (the constraint node + `createTable(constraints)` constructor + SQLite adapter constraint-rendering); the SQLite follow-up slice does the SQLite adapter byte-parity reconciliation + migrates SQLite `CreateTableCall.toOp()` onto the lower path, mirroring the Postgres pattern proven here. Its own ticket at pickup.
- **Mongo migration planner adoption.** This planner-adoption phase spans **all three targets, not just the SQL databases.** The Mongo migration planner's ops (`CreateCollection`/`CreateIndex`/… built today via the migration `*Call` path) must likewise construct the **contract-free Mongo command surface** (the `Create*Command` nodes the marker/ledger slice introduced) and route through `MongoControlAdapter.lower()` → driver, symmetric to the SQL planner adoption here. Tracked as a sibling follow-up slice.
- Unchanged by design: the step contract (`sql: string` stays — no `{sql,params}`-on-step yet), runner / preview / snapshot consumers, prechecks/postchecks (stay introspection `SELECT`s), the TS-migration render path (`renderTypeScript()`).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Planner `CREATE TABLE` carries constraints the slice-1 node can't express (composite PK, FK, unique) | Must extend the node | The design crux — see Chosen design + Open Question 1. Marker bootstrap only needed column-level PK, so this surface is genuinely new. |
| Native-type resolution (codec hooks / storage types → `SERIAL`/`INTEGER`/…) | Stays in the planner | It feeds `col(name, <type>, …)`; only the SQL *assembly* moves to the adapter. Don't relocate type resolution into the adapter. |
| SQLite create-table quirks: `INTEGER PRIMARY KEY AUTOINCREMENT` inline, `autoincrement()`→`''`, `now()`→`datetime('now')` | SQLite adapter visitor owns; pin against current output | The current `renderCreateTableSql`/`buildColumnDefaultSql` behaviour is the oracle; a test must show byte-parity. |
| Golden / migration-snapshot parity | Guard with fixtures | Lowered `CREATE TABLE`/`CREATE SCHEMA` must match current planner output (or the diff is reviewed + snapshots regenerated). `pnpm fixtures:check` + migration snapshot tests. |

## Slice-specific done conditions

- [ ] The table-level constraint node shape (Open Question 1) is settled by the first dispatch and recorded in `design-notes.md` before the planner call sites are migrated.
- [ ] **Postgres** `CreateTableCall.toOp()` + `CreateSchemaCall.toOp()` produce their `execute` step `sql` via `adapter.lower()` of a DDL node, with **no string-build fallback** (the planner tests pass a real lowerer and exercise the lower path); `git grep buildCreateTableSql` returns zero. _(SQLite's assembler legitimately remains — SQLite adoption is a follow-up slice.)_
- [ ] Rendered Postgres `CREATE TABLE` (incl. composite PK) + `CREATE SCHEMA` are **byte-identical to pre-D3 output, pinned by a test that drives `toOp(lower)`** (not just adapter-level rendering); migration golden/snapshot tests green with no regeneration; `pnpm fixtures:check` green.

## Open Questions

1. **Table-level constraint node shape.** How `CreateTable` expresses composite PK / FK / table-level unique (a target-contributed `constraints` array of frozen sub-nodes vs folding into a richer column/table descriptor; FK actions as opaque strings vs a small enum; how SQLite's inline-only forms are represented). Working position: a `constraints?: DdlTableConstraint[]` surface with frozen `PrimaryKey`/`ForeignKey`/`Unique` constraint nodes, adapter visitor renders them, targets contribute what they support. **Settled by dispatch 1 (in-slice spike), mirroring how `ddl-in-query-ast` settled its visitor API.**
2. **Native-type / default mapping fidelity.** The planner's `buildColumnTypeSql`/`buildColumnDefaultSql` encode dialect specifics (PG `SERIAL`, SQLite autoincrement/`now()`). Working position: type resolution stays planner-side feeding `col(type)`; default maps to `lit`/`fn`; the SQLite adapter visitor reproduces the SQLite-specific default forms, pinned by a parity test.
3. **Fan-out at plan time.** This slice may split (e.g. node-shape extension + adapter rendering as dispatch 1–2, planner migration as dispatch 3, Postgres-then-SQLite) — a `drive-plan-slice` concern, not a spec one.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md` (see the planner-adoption non-goal: "CREATE TABLE/CREATE SCHEMA first; the planner-adoption slice scopes the rest").
- Builds on (merged): slice `ddl-in-query-ast` — `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/ddl-in-query-ast/spec.md` ([TML-2761](https://linear.app/prisma-company/issue/TML-2761)).
- Reference consumer pattern: slice `sql-marker-ops-through-adapter` ([TML-2753](https://linear.app/prisma-company/issue/TML-2753)); marker bootstrap in `postgres/src/contract-free/control-bootstrap.ts` + `postgres/src/core/migrations/runner.ts`.
- Surfaces this slice touches (grounded): planner `op-factory-call.ts` + `operations/tables.ts` + `planner-ddl-builders.ts` (Postgres + SQLite); DDL nodes `ast/ddl-types.ts` + target `core/ddl/nodes.ts`; constructors `contract-free/column.ts` + target `contract-free/ddl.ts`; adapter `core/ddl-renderer.ts` (Postgres + SQLite); step contract `2-sql/9-family/src/core/migrations/types.ts`.
- Linear issue: [TML-2754](https://linear.app/prisma-company/issue/TML-2754) (narrowed to this first slice; remaining op-families + Mongo planner-adoption become sibling slices/tickets).
- Design notes: `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md`.
