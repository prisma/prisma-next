# TML-2656 — `distinct()` on non-leaf includes via lateral/subquery

Linear: <https://linear.app/prisma-company/issue/TML-2656/sql-orm-distinct-on-non-leaf-include-falls-back-to-multi-query>

## Purpose

Land single-query (lateral / correlated-subquery) lowering for include trees that carry `distinct()` on a non-leaf level. After this, the `hasNonLeafIncludeWithDistinct` arm of the dispatch gate disappears and the planner stops throwing on the shape.

This is the third of three load-bearing gates blocking removal of the multi-query read path (the other two — TML-2594 nested includes and TML-2595 scalar / `combine()` — have landed).

## Scope

In:

- Replace the `SELECT DISTINCT <scalars>, json_agg(<nested>)` shape (Postgres rejects equality on `json`) with a CTE / wrapped-subquery shape that dedupes scalar columns first, then attaches grandchild aggregates onto the deduped rows.
- Uniform across the two single-query strategies (`lateral`, `correlated`) and across the two single-query-capable targets we ship (Postgres, SQLite).
- Drop the `hasNonLeafIncludeWithDistinct` arm of `dispatchWithIncludeStrategy` in `collection-dispatch.ts`.
- Drop the matching `throw` in `compileSelectWithIncludeStrategy` in `query-plan-select.ts`.
- Force the grandchild join keys (every immediate nested include's `localColumn`) into the distinct CTE's projection — the same force-include logic the multi-query stitcher applies — so dedupe is per `(user-distinct-cols, join-keys)` and grandchildren stitch correctly. "Hidden" force-included columns are stripped from the user-visible row shape.

Out:

- Target-specific `DISTINCT ON (...)` optimizations for Postgres. Deferred until benchmarks demonstrate the uniform lowering has measurable cost worth removing.
- Removal of the multi-query include strategy itself. Tracked in TML-2657 and blocked by this slice landing.

## Decisions pinned

- D1. **Uniform CTE / wrapped-subquery lowering across `lateral` and `correlated`, across Postgres and SQLite.** No capability-gated branches. The CTE shape is the same; the only difference between the strategies is how the outer `json_agg` is attached (lateral join vs correlated subquery).
- D2. **Force-include join keys for grandchildren into the distinct CTE.** Mirrors `resolveRowsByParent` in `collection-dispatch.ts`. Without this, a user `.select('title').distinct('title').include('comments')` would lose `posts.id`, and the grandchild correlated subquery could not find its parent.
- D3. **`distinct()` semantics across the boundary stay bit-for-bit with the multi-query stitcher.** Because join keys are force-included alongside user-distinct columns, dedupe never actually collapses rows whose ids differ. This matches the current observable behavior and avoids changing user-visible output.
- D4. **`distinctOn(...)` is unchanged.** Postgres `DISTINCT ON` compares only the `ON (...)` keys for equality, so the existing builder shape (key column + json projection) is already well-defined. The new gate-removal is specific to `distinct()`.

## Acceptance criteria

- AC1. `include('comments', c => c.distinct(...).include('replies'))` on the Postgres test contract resolves in **1 SQL execution** under both `lateral` and `correlated` capabilities.
- AC2. The corresponding shape on SQLite resolves in 1 SQL execution. (Out of immediate test scope — Postgres tests are the integration spine; SQLite coverage rides on the planner.)
- AC3. Result row shape matches the current multi-query stitcher output bit-for-bit on scalar columns, including when `.select(...)` excludes the grandchild join key (force-include path).
- AC4. `dispatchWithIncludeStrategy` no longer references `hasNonLeafIncludeWithDistinct`. The predicate may stay in `include-tree-predicates.ts` (no callers; unused exports caught by lint) or be deleted; the deletion side is the simpler patch.
- AC5. `compileSelectWithIncludeStrategy` no longer throws on the shape. The planner builds the CTE form instead.
- AC6. Existing `nested-includes-strategy.test.ts` cases that pin "`distinct()` on a non-leaf include stays on multi-query" flip to assert single-query execution. (Strictly: they get updated to the new dispatch behavior, not deleted — the suite covers correlated and lateral capabilities both.)
- AC7. New `nested-includes-distinct.test.ts` integration suite asserts: single-execution count, result shape across the most-load-bearing variants (depth-2 hasMany + leaf hasMany, depth-2 hasMany + leaf belongsTo, depth-3 with distinct at depth 1 or 2, distinct + refinements, distinct + `.select(...)` excluding join keys, self-relations, empty grandchildren).

## Out of scope

- The `DISTINCT ON` optimization for Postgres specifically — file follow-up tech-debt at slice close.
- The full deletion of the multi-query include read path — that's TML-2657.
- Document-target (MongoDB) lowering for `distinct()` on non-leaf includes — separate concern; this slice is SQL-only.

## Test-derivation pattern

Integration tests run against the dev PGlite instance via `withCollectionRuntime`. Each test:
1. Seeds a minimal disjoint dataset (per the convention of `nested-includes-*.test.ts`).
2. Builds the collection with explicit `LATERAL_CAPABILITIES` or `CORRELATED_CAPABILITIES` so dispatch is unambiguous.
3. `runtime.resetExecutions()` then runs the query.
4. Asserts both `runtime.executions.length === 1` (single execution) and the full row tree (`expect(rows).toEqual([...])`).

Tests use explicit `.select(...)` projections to keep assertion shapes stable.
