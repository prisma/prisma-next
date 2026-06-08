# Brief: D2 — Migrate `SqliteCreateTableCall.toOp(lowerer)` to the lower path

## Task

Rewrite `SqliteCreateTableCall.toOp(lowerer)` (in `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts`) so it builds a `SqliteCreateTable` DDL node via the contract-free `createTable({ table, columns, constraints?, ifNotExists? })` constructor (exported from `@prisma-next/target-sqlite/contract-free` — confirm the exact subpath via grep), lowers the node through `lowerer.lower(node, { contract: {} })`, and returns the `Op` whose `execute[0].sql` is the lowered string. The `SqliteTableSpec → { columns, constraints? }` mapping goes inline in the method. Throw a clear error when called without a `lowerer` — mirror the PG version's error shape (read `PostgresCreateTableCall.toOp` at `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:198` for the exact `throw new Error(\`CreateTableCall.toOp: ...\`)` form). Add a unit test that drives `SqliteCreateTableCall.toOp(lowerer)` end-to-end with a real `createSqliteAdapter()` and asserts the rendered `CREATE TABLE` SQL is **byte-identical** to the current planner output across several representative shapes (simple column-only, composite PK, FK, unique, autoincrement). The free `createTable(...)` Op-builder at `operations/tables.ts:45` and its `renderCreateTableSql` helper at line 22 STAY — both are still used by `recreateTable(...)` at line 171 (Phase 2). Only the `CreateTableCall.toOp()` code path stops calling them.

## Scope

**In:**
- `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` — `SqliteCreateTableCall.toOp(lowerer)` body rewritten to build a `SqliteCreateTable` node + lower it; clear error when `lowerer === undefined`. The `SqliteTableSpec → { columns, constraints? }` mapping is inline (one function or fold into the toOp body — implementer's call).
- A new test file (or extension to an existing one — implementer's discretion based on where parallel PG byte-parity tests live) that drives `SqliteCreateTableCall.toOp(lowerer)` with `createSqliteAdapter()` and asserts byte-parity vs the current `renderCreateTableSql` output across: simple table, composite PK, FK with `onDelete`/`onUpdate` actions, table-level unique, INTEGER PRIMARY KEY AUTOINCREMENT (the SQLite-specific PK form), and a column with a function default (e.g. `now()` mapping to `datetime('now')` if SQLite's planner does that translation). The PG byte-parity test for reference: search `packages/3-targets/6-adapters/postgres/test/migrations/` for `op-factory-call.construction.test.ts` or similar.
- The `createTable(this.tableName, this.spec)` call inside `SqliteCreateTableCall.toOp()` is replaced (live-path grep gate: `git grep "createTable(this.tableName, this.spec)" -- 'packages/3-targets/3-targets/sqlite/'` returns zero).

**Out:**
- `operations/tables.ts:22` (`renderCreateTableSql`) and `operations/tables.ts:45` (free `createTable`) **stay in place** — they're still called by `recreateTable(...)` at line 171, which is Phase 2.
- Any other `*Call.toOp()` body — `DropTableCall`, `RecreateTableCall`, `AddColumnCall`, `DropColumnCall`, `CreateIndexCall`, `DropIndexCall`, `DataTransformCall`, `RawSqlCall` all stay exactly as D1 left them (signatures accept `lowerer?` and ignore it).
- `SqliteMigration` base class — D3 owns the user-facing API.
- Any change to PG, Mongo, or non-SQLite surface.

## Completed when

- [ ] `git grep "createTable(this.tableName, this.spec)" -- 'packages/3-targets/3-targets/sqlite/'` returns ZERO matches.
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck` passes (production AND test typecheck).
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck` shows no NEW failures vs main (the pre-existing `db-init-update.cli.test.ts` / `runner.basic.test.ts` / `runner.ledger.test.ts` TS2345 errors filed as TML-2860 still legitimately fail; everything else is green).
- [ ] `pnpm --filter @prisma-next/target-sqlite test` passes.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite test` passes (with the same TML-2860 caveat for the integration tests that require the missing `adapter` field — those are pre-existing TS errors, not test failures).
- [ ] The new byte-parity test passes; it covers ≥5 representative table shapes (simple, composite-PK, FK, unique, autoincrement).
- [ ] `pnpm fixtures:check` green — no migration fixture drift.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Halt conditions

- The byte-parity test fails on ANY representative shape — that means the SQLite adapter renderer disagrees with `renderCreateTableSql` on some construct; surface the diff (do not regenerate fixtures or hand-fix the test).
- The `SqliteTableSpec → { columns, constraints? }` mapping requires a missing input shape (e.g. SQLite carries something `SqlitePartitionedColumnSpec` that the contract-free `createTable` constructor's `col(...)` builder doesn't model) — surface; do not invent new constraint kinds or extend the constructor unilaterally.
- A migration fixture diff appears in `pnpm fixtures:check` — that means lowering produced different SQL from the planner's old assembler; surface the diff. The slice DoD demands byte-identity.
- More than 8 files touched — surface; the migration should be ~3 files (the one toOp body + the new test + maybe a small mapping helper).

## References

- **Slice spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/spec.md` (§ Chosen design § `CreateTableCall.toOp()` migration).
- **Slice plan entry:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/plan.md` § Dispatch 2.
- **D1 commit (just landed):** `de813cb18` — threaded the `Lowerer` end-to-end. `SqliteCreateTableCall.toOp(lowerer?: Lowerer): Op` already accepts the optional arg; D2's job is to use it.
- **PG pattern to mirror:** `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:198` — `PostgresCreateTableCall.toOp(lowerer)` body. The error message shape, the `lowerer.lower(node, { contract: {} })` call, the `Op` return shape — all of these you mirror onto SQLite with `SqliteCreateTable` + `sqlite` target id.
- **`Lowerer` interface:** `@prisma-next/family-sql/control-adapter`.
- **`SqliteCreateTable` DDL node:** `packages/3-targets/3-targets/sqlite/src/core/ddl/nodes.ts:25`.
- **Contract-free SQLite `createTable` constructor:** `packages/3-targets/3-targets/sqlite/src/contract-free/ddl.ts` (confirm the export shape via grep).
- **SQLite adapter renderer (read-only — substrate, do not modify):** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` (renders the node) + `packages/3-targets/6-adapters/sqlite/src/core/adapter.ts:90` (routes DDL to `renderLoweredDdl`).
- **Existing SQLite adapter byte-parity tests** for constraints (read-only — your new test extends coverage, not replaces): `packages/3-targets/6-adapters/sqlite/test/ddl-table-constraints-lowering.test.ts`.

## Operational metadata

- **Model tier:** sonnet — surgical substrate change with load-bearing byte-parity test; pattern proven on PG.
- **Time-box:** 90 minutes wallclock.

## Repo standing constraints

- Worktree boundary: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Operate ONLY inside it.
- Use `pnpm`, never `npm`/`npx`.
- No bare `as` casts in production code (use `blindCast`/`castAs`); test files are exempt.
- Don't add file extensions to TS imports.
- After changing exported types in a workspace package consumed elsewhere, run that package's `pnpm build` before validating downstream typecheck.
