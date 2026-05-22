# TML-2656 — `distinct()` on non-leaf includes via lateral/subquery

Linear: <https://linear.app/prisma-company/issue/TML-2656/sql-orm-distinct-on-non-leaf-include-falls-back-to-multi-query>

## Purpose

Land single-query (lateral / correlated-subquery) lowering for include trees that carry `distinct()` on a non-leaf level, AND fix `.distinct(cols)` semantics across all three planner call sites (top-level, leaf-include, non-leaf-include) so it actually dedupes by the user-specified columns the way Prisma does. After this, the `hasNonLeafIncludeWithDistinct` arm of the dispatch gate disappears, the planner stops throwing on the shape, and `.distinct('title')` keeps one row per `(title)` group everywhere — not zero, as it did before this slice.

This is the third of three load-bearing gates blocking removal of the multi-query read path (the other two — TML-2594 nested includes and TML-2595 scalar / `combine()` — have landed).

## Scope

In:

- Replace the SQL `DISTINCT` lowering of `.distinct(cols)` with a `ROW_NUMBER() OVER (PARTITION BY <user distinct cols> ORDER BY <user orderBy>) = 1` wrap that keeps one representative row per `(distinct cols)` group. Plain `DISTINCT` dedupes by the full projected row, which never collapses anything once an `id` (or any unique column) is in the projection — so the old code path was effectively a no-op everywhere the projection had a unique column, which is essentially always. The new lowering matches Prisma's documented `.distinct(cols)` behaviour.
- Apply the fix at all three planner call sites that today lower `state.distinct` to `withDistinct(true)`:
  - `buildSelectAst` (top-level `findMany.distinct(cols)`)
  - the leaf-include branch of `buildIncludeChildRowsSelect`
  - `buildDistinctNonLeafChildRowsSelect` (the non-leaf-include case that originally scoped TML-2656)
- Add the `WindowFuncExpr` AST node (with `ROW_NUMBER` as the first function; `rank` and `dense_rank` reserved) to `@prisma-next/sql-relational-core/ast`, and wire renderer support in the Postgres and SQLite adapters. Both targets emit the identical `fn() OVER (PARTITION BY … ORDER BY …)` shape.
- Uniform lowering across both single-query strategies (`lateral`, `correlated`) and both targets we ship (Postgres, SQLite). No capability-gated branches.
- For the non-leaf case: force-include the grandchild join keys (every immediate nested include's `localColumn`) into the inner subquery's projection so the outer aggregates can correlate back to the deduped rows. Crucially, the force-included columns appear in the **projection** only — they do **not** enter the `PARTITION BY` — so they no longer defeat dedup. "Hidden" force-included columns are stripped from the user-visible row shape in the outer wrap.
- Drop the `hasNonLeafIncludeWithDistinct` arm of `dispatchWithIncludeStrategy` in `collection-dispatch.ts`.
- Drop the matching `throw` in `compileSelectWithIncludeStrategy` in `query-plan-select.ts`.

Out:

- Target-specific `DISTINCT ON (...)` optimisation for Postgres. The portable `ROW_NUMBER` shape is correct and uniform across both targets we ship; per-target optimisation can wait for a proper query planner architecture.
- Removal of the multi-query include strategy itself. Tracked in TML-2657 and blocked by this slice landing.
- A primary-key tiebreaker when the user's `orderBy` doesn't fully order rows within a partition. We match Prisma's documented behaviour: the pick is implementation-defined when the user doesn't supply a total order.

## Decisions pinned

- D1. **Uniform `ROW_NUMBER`-based lowering across `lateral` and `correlated`, across Postgres and SQLite.** No capability-gated branches. The shape is the same on every target. Both Postgres and SQLite (3.25+, 2018) support window functions natively with identical `fn() OVER (…)` syntax; the renderer for each adapter just emits the same string.
- D2. **Force-include join keys for grandchildren into the inner subquery's projection, but NOT into the `PARTITION BY` clause.** Mirrors `resolveRowsByParent` in `collection-dispatch.ts` for the projection side. Without the projection force-include, a user `.select('title').distinct('title').include('comments')` would lose `posts.id` and the grandchild correlated subquery could not find its parent. Keeping force-included columns out of `PARTITION BY` is what makes `.distinct('title')` actually collapse by title rather than by `(title, id)` (the old bug).
- D3. **`.distinct(cols)` matches Prisma semantics: one representative row per `(cols)` group.** The representative is picked by the user's `orderBy` (if any) inside the `ROW_NUMBER() OVER` clause; when the orderBy doesn't fully order rows within a partition, the choice is implementation-defined — same as Prisma. This **changes** observable behaviour compared to the prior multi-query stitcher, which also had the no-collapse bug; that was a status-quo accident, not a design decision. The PR that lands this slice flips the integration-test assertions accordingly. Behaviour is consistent across all three call sites (top-level, leaf-include, non-leaf-include).
- D4. **`distinctOn(...)` is unchanged.** Postgres `DISTINCT ON` compares only the `ON (...)` keys for equality, so the existing builder shape (key column + json projection) is already well-defined. The new lowering is specific to `distinct()`.
- D5. **Aliasing the top-level dedup subquery as the original table name keeps outer references resolving transparently.** For the `findMany.distinct(cols)` path, the inner `ROW_NUMBER` subquery is wrapped as `DerivedTableSource.as(tableName, inner)`. From the outer SELECT's scope, `tableName.col` refs in the projection, MTI joins, include laterals' parent correlations, and orderBy continue to resolve — the wrap is transparent, no AST-wide column-ref rewrite is needed. The inner subquery projects every column of the underlying table so any outer reference is in scope.

## Acceptance criteria

- AC1. `include('comments', c => c.distinct(...).include('replies'))` on the Postgres test contract resolves in **1 SQL execution** under both `lateral` and `correlated` capabilities.
- AC2. The corresponding shape on SQLite resolves in 1 SQL execution. (Out of immediate test scope — Postgres tests are the integration spine; SQLite coverage rides on the planner.)
- AC3. `.distinct(cols)` produces one row per `(cols)` group on the user-visible row shape, matching Prisma semantics. Verified by the integration test assertions: when seed data has two posts sharing `title='A'` and one with `title='B'`, `.distinct('title')` returns two posts (one 'A', one 'B'), not three. The dropped row's grandchildren do not appear in the output. Holds across all three call sites (top-level, leaf-include, non-leaf-include).
- AC4. `dispatchWithIncludeStrategy` no longer references `hasNonLeafIncludeWithDistinct`. The predicate may stay in `include-tree-predicates.ts` (no callers; unused exports caught by lint) or be deleted; the deletion side is the simpler patch.
- AC5. `compileSelectWithIncludeStrategy` no longer throws on the shape. The planner builds the wrapped form instead.
- AC6. Existing `nested-includes-strategy.test.ts` cases that pin "`distinct()` on a non-leaf include stays on multi-query" flip to assert single-query execution. (Strictly: they get updated to the new dispatch behaviour, not deleted — the suite covers correlated and lateral capabilities both.)
- AC7. New `nested-includes-distinct.test.ts` integration suite asserts: single-execution count and result shape across the most-load-bearing variants (depth-2 hasMany + leaf hasMany, depth-2 hasMany + leaf belongsTo, depth-3 with distinct at depth 1 or 2, distinct + refinements, distinct + `.select(...)` excluding join keys, self-relations, empty grandchildren). All assertions reflect the new collapsing semantics.
- AC8. The `WindowFuncExpr` AST node renders identically on Postgres and SQLite (`fn() OVER (PARTITION BY … ORDER BY …)`). Verified by adapter unit tests in both adapters.

## Out of scope

- Target-specific `DISTINCT ON` optimisation for Postgres. The portable form is correct and the perf gap (if any) is unmeasured. Revisit when a proper query planner architecture exists.
- The full deletion of the multi-query include read path — that's TML-2657.
- Document-target (MongoDB) lowering for `distinct()` on non-leaf includes — separate concern; this slice is SQL-only.
- Adding `RANK` and `DENSE_RANK` window-function lowerings. The AST type allows them; renderers are generic over the function name; but neither is wired into any user-facing API in this slice.

## Test-derivation pattern

Integration tests run against the dev PGlite instance via `withCollectionRuntime`. Each test:
1. Seeds a minimal disjoint dataset (per the convention of `nested-includes-*.test.ts`), including **at least one duplicate** on every column that appears in `.distinct(...)` so the dedup actually has work to do.
2. Builds the collection with explicit `LATERAL_CAPABILITIES` or `CORRELATED_CAPABILITIES` so dispatch is unambiguous.
3. `runtime.resetExecutions()` then runs the query.
4. Asserts both `runtime.executions.length === 1` (single execution) and the full row tree (`expect(rows).toEqual([...])`) post-collapse.

Tests use explicit `.select(...)` projections to keep assertion shapes stable, and pair `.distinct(...)` with an `.orderBy(...)` that fully orders rows within each partition (typically `[distinctCol.asc(), id.asc()]`) so the picked representative is deterministic.
