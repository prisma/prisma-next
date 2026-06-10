# Brief: D3 — Refactor `SqliteCreateTableCall` to hold `DdlColumn[]`; migrate `toOp(lowerer)` with byte-parity proof

## Task

Mirror slice 4's PG refactor onto the SQLite side. `SqliteCreateTableCall` currently holds a `spec: SqliteTableSpec` (a flat struct with `defaultSql: string` pre-rendered SQL fragments) and its `toOp()` delegates to the free `createTable(tableName, spec)` Op-builder, which calls `renderCreateTableSql` (string concatenation). The PG analogue holds `columns: readonly DdlColumn[] + constraints?: readonly DdlTableConstraint[]` and its `toOp(lowerer)` builds a `SqliteCreateTable` DDL node via the contract-free `createTable({...})` constructor and lowers through `lowerer.lower(...)`. Do the same on SQLite.

The structural oracle is `PostgresCreateTableCall` at `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (the class definition + `toOp` body + `renderTypeScript`). SQLite has no schema concept, so the class skips the `schemaName` field and the `schema` option on the contract-free constructor call.

Three changes hang together:

1. **`SqliteCreateTableCall` class shape** (`packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts`): drop the `spec: SqliteTableSpec` field; add `columns: readonly DdlColumn[]` and `constraints?: readonly DdlTableConstraint[]`. Constructor takes `(tableName, columns, constraints?)`. `Object.freeze` the column / constraint arrays per the PG pattern.

2. **`toOp(lowerer)` body**: throw on missing `lowerer` (mirror PG's error text, with "createSqliteMigrationPlanner" instead of the PG planner name). Build the DDL node via `contractFreeDdl.createTable({ table: this.tableName, columns: this.columns, ...(this.constraints ? { constraints: this.constraints } : {}) })` (no schema option — SQLite has none). Lower via `lowerer.lower(node, { contract: {} })`. Return the `Op` with `execute: [step(\`create table "${this.tableName}"\`, sql)]` (matching the current shape).

3. **Upstream construction site** (`packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts:313` — `new CreateTableCall(issue.table, tableSpec)`): refactor to build `DdlColumn[]` and constraint nodes from whatever the planner currently feeds into `tableSpec`. Use the slice-1 `LiteralColumnDefault` / `FunctionColumnDefault` shapes (already imported by PG's `postgresDefaultToDdlColumnDefault` — `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` ~line 96 — write the SQLite analogue `sqliteDefaultToDdlColumnDefault` or similar, mirror the shape). Native-type resolution stays planner-side (whatever currently fills `SqliteColumnSpec.typeSql` continues to do so, feeding `col(name, <resolved-type>, …)`).

4. **`renderTypeScript()`** emits `this.createTable({ table: "...", columns: [col(...), ...], constraints: [...] })` — the user-facing authoring form. Mirror PG's `renderDdlColumnAsTsCall` / `renderDdlConstraintAsTsCall` helpers (`op-factory-call.ts` ~line 131). May be able to reuse PG's helpers if they live in a target-agnostic spot; otherwise duplicate the small shape into the SQLite file.

5. **Byte-parity test**: in `packages/3-targets/6-adapters/sqlite/test/migrations/`, add a test that drives `SqliteCreateTableCall.toOp(lowerer)` end-to-end with a real `createSqliteAdapter()` and asserts the rendered `CREATE TABLE` SQL is **byte-identical to the planner's current `renderCreateTableSql` output** for ≥5 representative table shapes (simple, composite PK, FK with actions, table-level unique, autoincrement). Adapter-level rendering tests in `ddl-create-table-lowering.test.ts` are not sufficient — the proof must exercise `toOp(lowerer)`.

The free `createTable(...)` Op-builder + its `renderCreateTableSql` helper at `operations/tables.ts:22,45` **stay** — they're still called by `recreateTable(...)` at line 171, which is Phase 2.

## Scope

**In:**
- `SqliteCreateTableCall` class shape change.
- `toOp(lowerer)` body migration with the missing-lowerer error.
- `renderTypeScript()` updated for the new field shape.
- Upstream construction site at `issue-planner.ts:313` builds `DdlColumn[]` + constraint nodes from the source data.
- A `sqliteDefaultToDdlColumnDefault`-style helper (or inline mapping) that maps SQLite's column-default shape to slice-1's `DdlColumnDefault` subclasses.
- New byte-parity test driving `toOp(lowerer)` across ≥5 representative shapes.

**Out:**
- `operations/tables.ts:22,45` (`renderCreateTableSql` + the free `createTable`) **stay** — `recreateTable` at line 171 still uses them. Phase 2.
- Any other `*Call` migration (`AddColumn`/`DropColumn`/`CreateIndex`/etc.) — Phase 2.
- The `SqliteMigration.createTable({...})` authoring method — that's D4.
- Any PG / Mongo / non-SQLite surface.

## Completed when

- [ ] `SqliteCreateTableCall` field shape mirrors PG (`columns: readonly DdlColumn[]` + `constraints?: readonly DdlTableConstraint[]`; no `spec` field).
- [ ] `git grep "createTable(this.tableName, this.spec)"` returns zero matches.
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck + test` green.
- [ ] New byte-parity test asserts `toOp(lowerer).execute[0].sql` is byte-identical to `renderCreateTableSql(tableName, spec)` for the ≥5 representative shapes. (The fixture for the test can build the same input on both sides — `SqliteTableSpec` for `renderCreateTableSql`, the corresponding `DdlColumn[]` + constraints for `toOp`.)
- [ ] `pnpm fixtures:check` green (no extension-migration drift).
- [ ] Migration golden / snapshot tests (if any in target-sqlite or adapter-sqlite) green with no regeneration.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes serving the goal go in the same commit with a one-line note. Drift halts. Don't touch the SQLite renderer (D2 just landed that); don't touch `SqliteMigration` (that's D4); don't migrate other `*Call` classes.

## Halt conditions

- Byte-parity test fails on any representative shape — surface the diff (do NOT regenerate fixtures or hand-fix the test). The slice DoD demands byte-identity post-D2.
- `tableSpec`'s upstream source data (in `issue-planner.ts`) doesn't carry enough info to construct structured `DdlColumnDefault` — surface; do NOT invent new node kinds.
- A migration fixture diff appears in `pnpm fixtures:check` — surface.
- More than 8 files touched — the migration should be ~3-5 files (op-factory-call + issue-planner + new test + maybe a helper file).

## References

- **Slice spec § Chosen design § Substrate fix (consumer side)** at `slices/sqlite-create-table-adoption/spec.md`.
- **Slice plan entry for D3** at `slices/sqlite-create-table-adoption/plan.md` § Dispatch 3.
- **PG structural oracle** (read in full before editing):
  - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` lines ~174–270 (the `CreateTableCall` class + `toOp` + `renderTypeScript` + helpers).
  - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` ~line 96: `postgresDefaultToDdlColumnDefault` — your SQLite analogue's shape.
- **SQLite upstream construction site:** `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts:313`.
- **`renderCreateTableSql` (the byte-parity oracle):** `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts:22`.
- **`SqliteCreateTable` DDL node:** `packages/3-targets/3-targets/sqlite/src/core/ddl/nodes.ts:25`.
- **Contract-free `createTable` constructor:** `packages/3-targets/3-targets/sqlite/src/contract-free/ddl.ts`.

## Operational metadata

- **Model tier:** sonnet — surgical class-shape refactor + the byte-parity proof; pattern proven on PG.
- **Time-box:** 90 minutes.

## Repo standing constraints

- Worktree boundary: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- `pnpm`, never `npm`/`npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- No transient project references in code / comments / test names — describe behaviour, not project orchestration.
