# Brief: D2 — Align the SQLite adapter renderer's DDL conventions with Postgres

## Task

`packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` currently emits `CREATE TABLE` output that's structurally divergent from the SQLite planner's `renderCreateTableSql` and from the PG adapter renderer:

- **No identifier quoting.** Line ~66: `const tableRef = node.table;`, line ~71: `CREATE TABLE ${tableRef}`. The planner's `renderCreateTableSql` and the PG adapter both wrap every identifier (table, column, constraint name, FK reference) with `quoteIdentifier`. The PR #751 review thread `3369313428` flagged this exact issue on the PG side and the fix landed there; the parallel SQLite fix never followed.
- **4-space indent + 2-space close.** Line ~71: `(\n    ${allDefs}\n  )`. The planner and the PG adapter both use 2-space indent throughout: `(\n  ${defs.join(',\n  ')}\n)`.

Update the SQLite adapter renderer to match the conventions the PG renderer establishes. Mirror line-for-line. The PG renderer at `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts` (lines ~21–80) is the structural oracle:

- `quoteIdentifier` (from `@prisma-next/adapter-sqlite/sql-utils` — confirm export, mirror the PG adapter's `sql-utils` import shape) wraps every identifier reference: `tableRef`, column names in `renderColumn`, constraint names, FK column lists, FK `refTable` (use a `quoteQualifiedIdentifier` helper that splits on `.` and quotes each segment, matching the PG version — even though SQLite doesn't have schemas, qualified table names CAN appear via `attached_db.table` syntax, so the helper applies).
- Indentation switches to 2-space throughout: `(\n  ${allDefs.join(',\n  ')}\n)`.
- The four `renderPrimaryKeyConstraint` / `renderForeignKeyConstraint` / `renderUniqueConstraint` / `renderTableConstraint` helpers mirror the PG ones — same shape, same `quoteIdentifier` discipline.

`renderColumn` keeps its existing AUTOINCREMENT short-circuit; the only change there is wrapping `column.name` in `quoteIdentifier` (consistent with PG `renderColumn` line ~121: `[quoteIdentifier(column.name), column.type]`).

## Scope

**In:**
- `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` — apply `quoteIdentifier` to every identifier reference + switch indentation to 2-space.
- `packages/3-targets/6-adapters/sqlite/test/ddl-table-constraints-lowering.test.ts` — update the four existing expected-SQL literals to the new (quoted + 2-space-indent) form. The tests' INTENT (the renderer produces correct constraint rendering) is preserved; the literal oracle was the wrong target.
- A new test pinning **mixed-case + reserved-word identifier handling** — `col('User', 'TEXT', ...)` etc. + a table named `order`. Demonstrates the convention does the work the bare-string form couldn't.

**Out:**
- The visitor's `literal` / `function` default-rendering bodies (TML-2861 already settled the visitor signature; SQLite ignores the ctx).
- `SqliteCreateTableCall` shape — D3 owns the consumer-side refactor (moving from `SqliteTableSpec` to `DdlColumn[]`).
- Any change to the SQLite planner's `renderCreateTableSql` or to `recreateTable` (which still uses the planner string-glue).
- PG, Mongo, or any non-SQLite surface.

## Completed when

- [ ] `git grep "node\.table\b" packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` returns no unquoted-identifier usage (every reference goes through `quoteIdentifier` / `quoteQualifiedIdentifier`).
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck` + `... test` green. The existing 4 constraint tests pass against the updated expected literals; the new mixed-case test passes.
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck` + `... test` green.
- [ ] No behaviour change downstream: marker-bootstrap DDL (the existing consumer) still renders correctly. If the existing `marker-table-ddl.test.ts` in adapter-sqlite asserts the unquoted form, update its expected literal — same intent-preserved discipline.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes (e.g. similar identifier-quoting gaps in adjacent SQLite renderer code) go in the same dispatch with a one-line note. Anything beyond renderer conventions (like reshaping `SqliteCreateTableCall`) halts and surfaces.

## Halt conditions

- The mixed-case / reserved-word test reveals SQLite quoting is meaningfully different from PG's `"<id>"` form (it isn't, but verify).
- An existing test outside `ddl-table-constraints-lowering.test.ts` and `marker-table-ddl.test.ts` asserts the buggy unquoted form — surface; do not silently rewrite.
- More than 4 files touched — surface; the change should be `ddl-renderer.ts` + 2 test files + maybe one new test file = 3-4 files.

## References

- **Slice spec § Spec amendment 2026-06-08 § Substrate fix** at `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/spec.md` — the in-scope work for D2.
- **Slice plan entry for D2** at `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/plan.md` § Dispatch 2.
- **PG adapter renderer (the convention oracle):** `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts` — read lines 20–80 in full before editing.
- **SQLite planner's `renderCreateTableSql`** (the 2-space-indent + identifier-quoting reference, NOT a code dependency): `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts:22`.
- `quoteIdentifier` location for SQLite: `@prisma-next/adapter-sqlite/sql-utils` (confirm via grep).

## Operational metadata

- **Model tier:** sonnet — surgical substrate change mirroring an existing convention.
- **Time-box:** 45 minutes. Overrun → halt and surface.

## Repo standing constraints

- Worktree boundary: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Operate ONLY inside it.
- Use `pnpm`, never `npm`/`npx`.
- No bare `as` casts in production code (use `blindCast`/`castAs`); test files exempt.
- Don't add file extensions to TS imports.
- No transient project references in code / comments / test names — describe behaviour, not project orchestration. (The `no-transient-project-ids-in-code` rule. Don't write `// TML-NNNN: …` or `it('… (TML-NNNN)')` decorations; describe the property the code or test pins.)
