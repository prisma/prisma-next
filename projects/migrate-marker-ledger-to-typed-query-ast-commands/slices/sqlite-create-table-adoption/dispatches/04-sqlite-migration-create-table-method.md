# Brief: D4 — `SqliteMigration.createTable({...})` authoring API + drop free re-export

## Task

Mirror what slice 4 / PR #751 shipped for Postgres on the user-facing authoring surface, now on the SQLite side. Three changes hang together:

1. **`SqliteMigration` base class** (`packages/3-targets/3-targets/sqlite/src/core/migrations/sqlite-migration.ts`) gains:
   - A constructor that accepts the `ControlStack` and builds + holds a `controlAdapter: SqlControlAdapter<'sqlite'> | undefined` from `stack?.adapter` (mirror `PostgresMigration`'s shape at `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` ~lines 46/53).
   - A `protected createTable(options: { table, columns, constraints?, ifNotExists? })` method that instantiates `SqliteCreateTableCall(tableName, columns, constraints)` and calls `.toOp(this.controlAdapter)` (mirror PG's `createTable` method at ~lines 79-94). Throw a clear error if `controlAdapter` is undefined.
2. **Drop the free `createTable` re-export** from `packages/3-targets/3-targets/sqlite/src/exports/migration.ts`. The line currently reads roughly `export { createTable, dropTable, recreateTable } from '../core/migrations/operations/tables';` — collapse to `export { dropTable, recreateTable } from ...`. `dropTable` / `recreateTable` stay free exports for now (they're Phase 2).
3. **Restore `CreateTableCall` coverage in the roundtrip test.** D3 dropped `CreateTableCall` from `packages/3-targets/6-adapters/sqlite/test/migrations/render-typescript.roundtrip.test.ts` because the rendered TS calls `this.createTable({...})`, which needs both a lowerer AND the method on the migration base class to evaluate. Now that the method exists, add `CreateTableCall` back to the roundtrip and ensure the test sets up a `SqliteMigration`-derived class with a real lowerer so the eval succeeds.

Also: update `packages/3-extensions/sqlite/test/migration/re-export.test.ts` if a corresponding assertion exists for free `createTable` (mirror PR #751's commit `0d09f8b0b` for the PG facade — drop or replace with a method-on-Migration note).

Record the breaking user-facing API change via the `record-upgrade-instructions` skill at the end of the dispatch — the new authoring form is `this.createTable({...})` instead of `createTable(...)` at module scope.

## Scope

**In:**
- `SqliteMigration` constructor + protected `createTable` method (one file).
- Remove free `createTable` from the SQLite migration facade re-export (one file).
- Update `packages/3-extensions/sqlite/test/migration/re-export.test.ts` if it tests the free `createTable` (PG facade had a similar test that needed updating).
- Restore `CreateTableCall` in the roundtrip test with a real-ish `SqliteMigration`-derived class + lowerer in scope.
- `record-upgrade-instructions` PR-time note for the user-facing API change.

**Out:**
- Any `*Call` migration other than `CreateTableCall` (those are Phase 2).
- Touching `operations/tables.ts` — the free `createTable` STAYS in the file (it's still called by `recreateTable`, Phase 2); only its re-export from the facade is dropped.
- The planner internals (`SqliteCreateTableCall`, `issue-planner.ts`) — D3 settled those.
- PG / Mongo / non-SQLite surface.

## Completed when

- [ ] `SqliteMigration.createTable({...})` method exists with the same shape as `PostgresMigration.createTable` and a clear error when `controlAdapter` is undefined.
- [ ] Free `createTable` is no longer re-exported from `@prisma-next/sqlite/migration`. `git grep "createTable, dropTable" -- packages/3-targets/3-targets/sqlite/src/exports/migration.ts` returns no match.
- [ ] `packages/3-extensions/sqlite/test/migration/re-export.test.ts` updated if it asserted free `createTable`.
- [ ] `CreateTableCall` restored in `render-typescript.roundtrip.test.ts` and the roundtrip eval succeeds (i.e. the test passes with `this.createTable({...})` rendered TS).
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/sqlite typecheck + test` green (the facade package).
- [ ] `pnpm fixtures:check` green.
- [ ] Upgrade instructions recorded via `record-upgrade-instructions` (separate file under `packages/3-extensions/.../upgrades/0.12-to-0.13/` or wherever the existing instructions live — grep for prior `createTable` instructions to find the right location).

## Standing instruction

Stay focused; control scope. Trivial-related fixes in the same commit with a one-line note; drift halts.

## Halt conditions

- The roundtrip test reveals a setup difficulty (e.g. the `SqliteMigration`-derived stub needs access to a stack or driver that's awkward to construct in a unit test) — surface; don't invent a parallel mock surface.
- A user-facing breaking change beyond `createTable` is needed to make this work — surface; the slice scope is `CreateTable` only.
- More than 6 files touched — the change should be ~4-5 (SqliteMigration + exports/migration + roundtrip test + re-export test + upgrade-instructions).

## References

- **Slice spec** at `slices/sqlite-create-table-adoption/spec.md` § Chosen design § `SqliteMigration` gains a `createTable({...})` method.
- **Slice plan** at `slices/sqlite-create-table-adoption/plan.md` § Dispatch 4.
- **PG structural oracle:** `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` (constructor + protected `createTable`).
- **PR #751 PG facade reference for the re-export drop:** commit `0d09f8b0b` on main — it removed free `createTable` from `target-postgres/migration` exports and updated the PG facade re-export test. Same shape, on the SQLite side.
- **D3 roundtrip-test commentary:** `packages/3-targets/6-adapters/sqlite/test/migrations/render-typescript.roundtrip.test.ts` — the comment in the test names what D4 needs to restore.

## Operational metadata

- **Model tier:** sonnet — small single-feature dispatch + a facade-cleanup with a precedent.
- **Time-box:** 60 minutes.

## Repo standing constraints

- Worktree boundary: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- `pnpm`, never `npm`/`npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- **No transient project references in code / comments / test names.** Describe behaviour, not project orchestration. Don't write `// D4` or `it('… (TML-NNNN)')` or `"matches the pre-#NNN behaviour"`. Name the property the test pins.
