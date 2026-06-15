# Brief: D1 — Thread `Lowerer` through the SQLite planner stack

## Task

Mirror slice 4's PG planner-lowerer plumbing onto SQLite. Make `createSqliteMigrationPlanner(lowerer: Lowerer)` require the arg; have `SqliteMigrationPlanner` hold it as `readonly #lowerer`; have `TypeScriptRenderableSqliteMigration`'s constructor accept an optional `lowerer?: Lowerer` and pass it through to `renderOps`; have `renderOps(calls, lowerer?: Lowerer)` forward to `c.toOp(lowerer)`; change the abstract `SqliteOpFactoryCallNode.toOp(): Op` signature to `toOp(lowerer?: Lowerer): Op` and update every concrete `*Call` subclass's `toOp` to match (each subclass's body continues to ignore the new optional arg — **no behaviour change in this dispatch**). Update `SqliteControlTargetDescriptor.createPlanner(adapter)` (both call sites — `migrations.createPlanner` at `control-target.ts:39` and the `@deprecated` direct method at `:70`) to pass `adapter` to `createSqliteMigrationPlanner(adapter)`; rename the `_adapter` param to `adapter`. Update all test call sites of `createSqliteMigrationPlanner()` (across `@prisma-next/target-sqlite` and `@prisma-next/adapter-sqlite`) to pass a real `SqlControlAdapter<'sqlite'>` via `createSqliteAdapter()` (it structurally satisfies `Lowerer`). Pure plumbing — no behaviour change anywhere.

## Scope

**In:**
- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts` — `createSqliteMigrationPlanner(lowerer: Lowerer)` + `SqliteMigrationPlanner.#lowerer` + both `new TypeScriptRenderableSqliteMigration(...)` call sites thread `this.#lowerer`.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-produced-sqlite-migration.ts` — constructor accepts `lowerer?: Lowerer`; pass to `renderOps`.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/render-ops.ts` — `renderOps(calls, lowerer?: Lowerer)` forwards to `c.toOp(lowerer)`.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` — abstract `toOp(lowerer?: Lowerer): Op` + all 9 concrete `*Call.toOp(lowerer?)` signatures (bodies unchanged — they ignore the optional arg).
- `packages/3-targets/3-targets/sqlite/src/core/control-target.ts` — both `createPlanner(adapter)` sites pass `adapter` and the param rename.
- All test call sites of `createSqliteMigrationPlanner()` updated to pass `createSqliteAdapter()`. The grep is `git grep "createSqliteMigrationPlanner()"`; iterate until zero matches.

**Out:**
- Any change to `*Call.toOp()` **bodies**. They stay exactly as they are; only signatures change.
- Any change to `operations/tables.ts` or `operations/*.ts` — D2 owns the `CreateTableCall` body migration; the free Op-builders stay called by ignored-lowerer bodies.
- Any change to `SqliteMigration` (D3 owns the user-facing API).
- Any change to PG, Mongo, or any non-SQLite surface.

## Completed when

- [ ] `git grep "createSqliteMigrationPlanner()"` returns ZERO matches across the entire repo.
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck` passes (production AND test typecheck).
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck` passes (production AND test typecheck).
- [ ] `pnpm --filter @prisma-next/target-sqlite test` passes — every test green.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite test` passes for non-DB-backed tests; integration tests that need a live external DB (those that don't use PGlite or sqlite-in-memory) may legitimately fail to connect — note them and continue.
- [ ] No `.toOp()` body in `op-factory-call.ts` is modified — only the signatures change.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Halt conditions

- Any test fails with `lower.lower is not a function` after the plumbing — that means a test wasn't updated to pass a real adapter. Find it; fix it; don't push past.
- Behaviour change observed (any test result diff vs main beyond previously-failing-integration-test-needs-DB) — that's wrong; D1 is plumbing-only.
- More than 30 files touched — surface; the fan-out should be ~17–22 files.
- A test that calls `createSqliteMigrationPlanner` cannot construct an adapter cleanly (some test fixture lacks the means) — surface; do not silently invent a new fixture.

## References

- **Slice spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/spec.md` (read the Chosen design § Lowerer plumbing section).
- **Slice plan entry:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sqlite-create-table-adoption/plan.md` § Dispatch 1.
- **Pattern reference — the PG version of this same plumbing, already merged:** read these files for the exact shape:
  - `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (post-#751 state — `createPostgresMigrationPlanner(lowerer: Lowerer)` + `#lowerer` field).
  - `packages/3-targets/3-targets/postgres/src/core/migrations/planner-produced-postgres-migration.ts`.
  - `packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts`.
  - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (abstract + the `toOp(lowerer?: Lowerer): Op` shape).
- **`Lowerer` interface:** exported from `@prisma-next/family-sql/control-adapter`.
- **`SqlControlAdapter<'sqlite'>` factory:** `createSqliteAdapter()` from `@prisma-next/adapter-sqlite/adapter`.

## Operational metadata

- **Model tier:** sonnet — mechanical fan-out across many sites; pattern proven on PG.
- **Time-box:** 90 minutes wallclock. Overrun → halt and surface.

## Repo standing constraints

- Worktree boundary: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Operate ONLY inside it.
- Use `pnpm`, never `npm`/`npx`. Use the shell's Node (don't `nvm`/`fnm`).
- No bare `as` casts in production code (use `blindCast`/`castAs` from `@prisma-next/utils/casts`); test files are exempt.
- Don't add file extensions to TS imports.
- After changing exported types in a workspace package consumed elsewhere, run that package's `pnpm build` to refresh `dist/*.d.mts` before validating downstream typecheck.
