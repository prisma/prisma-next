# Brief: D6 — Migrate marker/ledger bootstrap to the typed path; `lower()` rejects DDL; delete the old DDL renderer

## What this dispatch does — and why it's the headline

This is the parent project's namesake deliverable: **migrate the marker/ledger bootstrap DDL onto the typed-query-AST lowering path** (`lowerToExecutableStatement`). The codec slice built that path; D6 routes the bootstrap through it and collapses the two DDL walkers into one.

The structural truth that drives the shape: **DDL-lowering is inherently async.** `lower()` is sync and defers codec encoding to the driver (`encodeParams`) — fine for query params, which become `$N` placeholders. DDL `DEFAULT` clauses cannot be parameterized, so the codec must run inline, which is async. A sync method structurally cannot codec-encode an inline DDL default. So:

- `lowerToExecutableStatement` (async) becomes **the** DDL lowering path.
- `lower()` (sync) **rejects DDL** on every adapter — control and runtime. Today the runtime adapter's DDL branch "works" only by using the old type-branching renderer, i.e. it carries the exact bug D5 fixed. Rejecting is strictly better than silently-buggy. (Operator decision: the runtime adapter doesn't need to lower DDL today; if that need ever arises, the async method gets added to it then. Confirmed.)
- The old `renderLoweredDdl` renderer is then unused and deleted.

## Concrete changes

### 1. Migrate the bootstrap sign-marker loop

`packages/2-sql/9-family/src/core/control-instance.ts` ~line 709–712:

```ts
// before
for (const query of controlAdapter.bootstrapSignMarkerQueries()) {
  const lowered = controlAdapter.lower(query, lowererContext);
  await driver.query(lowered.sql, lowered.params);
}
// after
for (const query of controlAdapter.bootstrapSignMarkerQueries()) {
  const lowered = await controlAdapter.lowerToExecutableStatement(query, lowererContext);
  await driver.query(lowered.sql, lowered.params);
}
```

`controlAdapter` is a `SqlControlAdapter` → has `lowerToExecutableStatement`. Already in async context (`await driver.query` follows).

### 2. Make `lowerAst` async, route through the typed path

`control-instance.ts`: the `lowerAst` interface declaration (~line 243) and implementation (~line 860).

```ts
// interface — before
lowerAst(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;
// after
lowerAst(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<ExecutableStatement>;

// impl — before
lowerAst(ast, context) { return getControlAdapter().lower(ast, context); }
// after
lowerAst(ast, context) { return getControlAdapter().lowerToExecutableStatement(ast, context); }
```

`lowerAst` is SQL-family-only (no Mongo implementor — verified). Its callers are both migration runners:
- `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts:298, 304`
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts:316`

They currently do `await this.executeStatement(driver, this.family.lowerAst(query, ctx))`. Change to `await this.executeStatement(driver, await this.family.lowerAst(query, ctx))`. (Both runners are already async.) `executeStatement` takes a `{sql, params}` — both `LoweredStatement` and `ExecutableStatement` satisfy that, so no further change there.

These runner sites lower bootstrap DDL (`schemaQuery`, control-table `tableQueries`) **and** verification SELECTs through the same `lowerAst`. Routing both through `lowerToExecutableStatement` is correct — its query-AST branch (from D5) handles SELECTs (wire-encoded params), its DDL branch handles the bootstrap DDL.

### 3. `lower()` rejects DDL on all four adapters

Replace the `if (isDdlNode(ast)) return renderLoweredDdl(ast)` branch with a throw, in:
- `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:170` (control)
- `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:160` (control)
- `packages/3-targets/6-adapters/postgres/src/core/adapter.ts:78` (runtime)
- `packages/3-targets/6-adapters/sqlite/src/core/adapter.ts:90` (runtime)

The throw names the replacement, e.g.:
```ts
if (isDdlNode(ast)) {
  throw new Error(
    'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecutableStatement().',
  );
}
```
The query branch (`renderLoweredSql(...)`) stays unchanged on all four. Remove the now-unused `renderLoweredDdl` import from each file.

**Verify no other caller passes DDL to `lower()`.** The `lower = (query) => this.lower(query, { contract: undefined })` patterns inside the adapters all pass query ASTs (catalog probes, marker reads) — they don't hit the DDL branch. After steps 1–2, nothing passes DDL to `lower()`. Grep to confirm; if a DDL-through-`lower()` caller survives, migrate it too or surface it.

### 4. Delete the old DDL renderer

Both `ddl-renderer.ts` files (`packages/3-targets/6-adapters/{postgres,sqlite}/src/core/ddl-renderer.ts`) contain only file-private helpers serving `renderLoweredDdl` (`quoteQualifiedIdentifier`, `renderPrimaryKeyConstraint`, `renderForeignKeyConstraint`, `renderUniqueConstraint`, `renderTableConstraint`, `isTextLikeNativeType` [PG], `defaultVisitor`, `renderColumn`, `renderLoweredDdl`). Only `renderLoweredDdl` is exported, and after step 3 nothing imports it. **Delete both files wholesale.**

Before deleting, grep for any test that imports from `ddl-renderer` directly (e.g. a `ddl-renderer.test.ts` or a test importing `renderLoweredDdl`). Delete those tests — their coverage moved to the `lower-to-executable-statement.test.ts` suites (D5). If a test asserts `lower()` renders DDL, update it to assert the throw, or to use `lowerToExecutableStatement`.

The new walker in `control-adapter.ts` (`pgRenderDdlExecutableStatement` + its own constraint/column helpers, from D5) is self-contained — it does not import from `ddl-renderer.ts`. So deleting the old file leaves the new walker intact.

### 5. Bootstrap SQL drift check (the one real risk)

The bootstrap control tables (`_prisma_marker`, `_prisma_ledger`, the schema) have no codec-bearing defaults, so the new walker should produce SQL byte-identical to the old `renderLoweredDdl` for them. **But the two walkers are independently written** — if the new walker formats DDL even slightly differently (whitespace, clause order, quoting), bootstrap SQL changes and any test/golden pinning it regenerates.

Run the migration + e2e suites. If bootstrap SQL drifts:
- If the drift is cosmetic and the new form is correct → accept, regenerate the affected goldens, note which in the report.
- If the new walker produces *wrong* bootstrap SQL (a real format regression vs the old renderer) → **halt** and surface the diff. The bootstrap must stay correct.

## Out of scope

- Adding an async DDL path to the runtime adapter (future work if a runtime DDL need ever materializes).
- The codec wiring itself (D5, done).
- Any `*Call.toOp` / planner / framework-interface change (D1–D5).

## Completed when

- [ ] Bootstrap sign-marker loop + control-table bootstrap (via `lowerAst`) lower through `lowerToExecutableStatement`.
- [ ] `lowerAst` is async, returns `Promise<ExecutableStatement>`, delegates to `lowerToExecutableStatement`; both runners `await` it.
- [ ] `lower()` throws on DDL in all four adapters (2 control + 2 runtime); the query branch is unchanged; the `renderLoweredDdl` import is removed from each.
- [ ] Both `ddl-renderer.ts` files deleted; no remaining importer of `renderLoweredDdl` (`git grep renderLoweredDdl` clean); old-renderer tests deleted or repointed.
- [ ] Bootstrap SQL verified unchanged (or goldens regenerated for accepted cosmetic drift, noted in report).
- [ ] `pnpm typecheck` (full) / `pnpm test:packages` / `pnpm test:integration` / `pnpm test:e2e` (bootstrap runs end-to-end here) / `pnpm fixtures:check` / `pnpm lint:deps` green; `pnpm lint:casts` delta ≤ 0.

## Halt conditions

- A DDL-through-`lower()` caller survives steps 1–2 that isn't bootstrap/`lowerAst` — surface it; don't guess.
- The new walker produces wrong (not merely cosmetically different) bootstrap SQL — halt with the diff.
- `lowerAst` turns out to have a non-SQL implementor or a sync-only caller that can't await — surface (verified SQL-only + async callers, but confirm).
- Deleting `ddl-renderer.ts` breaks an importer the grep missed — surface.
- More than 20 files — halt.
- 200+ tool calls without committing — halt.

## References

- **Spec (2026-06-09 amendment):** `../spec.md`. **Plan (§ Dispatch 6):** `../plan.md`.
- Bootstrap loop: `packages/2-sql/9-family/src/core/control-instance.ts:709`; `lowerAst` interface `:243`, impl `:860`.
- Runners: `postgres/.../runner.ts:298,304`; `sqlite/.../runner.ts:316`.
- `lower()` DDL branches: control `control-adapter.ts:170` (PG) / `:160` (SQLite); runtime `adapter.ts:78` (PG) / `:90` (SQLite).
- Old renderers (delete): both `ddl-renderer.ts`.
- New walker (keep): `pgRenderDdlExecutableStatement` / `sqliteRenderDdlExecutableStatement` in the two `control-adapter.ts`.

## Operational metadata

- **Model tier:** sonnet. **Time-box:** 90 min. **Tool-call budget:** 200 before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Branch: `tml-2867-codec-routed-ddl-defaults`. HEAD: `cf56d91e2`.
- `pnpm`, never `npm`/`npx`. No bare `as` casts in production (`blindCast<T,'reason'>`). No TS import file extensions. No transient project refs in code.
- Stale-dist after type changes is common: if a `Cannot find module '@prisma-next/...'` typecheck error appears, `pnpm build` (or `rm -rf <pkg>/dist && pnpm --filter <pkg> build`) and re-run. The pre-commit `lint-deps-focused` hook OOMs on large staged sets — if it SIGKILLs, run `pnpm lint:deps` standalone (it passes) and commit `--no-verify`, noting it.

## Commit + sign-off

Commit on the branch. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
