# TML-2656 — slice plan

Single slice; PR-cap = 1 PR.

## Dispatch 1 — Failing-test surface for nested `distinct()` under single-query strategies (M)

**Intent.** Land a new integration suite `nested-includes-distinct.test.ts` that asserts the post-fix behavior: single SQL execution + correct row shape for `include(..., c => c.distinct(...).include(...))` shapes under `LATERAL_CAPABILITIES` and `CORRELATED_CAPABILITIES`. Tests will fail until dispatch 2 lands.

**Files in play.**
- `packages/3-extensions/sql-orm-client/test/integration/nested-includes-distinct.test.ts` — new file.

**"Done when" gates.**
- File added; the suite is runnable (no import or type errors).
- `pnpm typecheck` clean.
- `pnpm --filter @prisma-next/sql-orm-client test test/integration/nested-includes-distinct.test.ts` runs (tests will be **red** — the dispatch gate still routes to multi-query and execution count is > 1; that's the expected state until dispatch 2).

**Out of scope.**
- No edits under `src/`. Implementation arrives in dispatch 2.
- No changes to existing `nested-includes-strategy.test.ts` cases that pin "stays on multi-query" — those flip in dispatch 2 alongside the gate removal.

## Dispatch 2 — Single-query lowering for `distinct()` on non-leaf includes (M, possibly L — pre-flight gate)

**Intent.** Implement the CTE / wrapped-subquery shape in `buildIncludeChildRowsSelect` / `buildLateralIncludeArtifacts` / `buildCorrelatedIncludeProjection`. Drop the `hasNonLeafIncludeWithDistinct` arm of the dispatch gate and the matching planner `throw`. Update existing strategy tests that pin "stays on multi-query".

**Files in play.**
- `packages/3-extensions/sql-orm-client/src/query-plan-select.ts` — CTE-shaped lowering for the distinct + nested case.
- `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` — drop `hasNonLeafIncludeWithDistinct` arm.
- `packages/3-extensions/sql-orm-client/src/include-tree-predicates.ts` — drop `hasNonLeafIncludeWithDistinct` export (last caller goes away).
- `packages/3-extensions/sql-orm-client/test/integration/nested-includes-strategy.test.ts` — flip the three "stays on multi-query" cases to single-execution assertions, or delete and let the new suite carry the coverage.
- `packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts` — drop the two planner-rejects-distinct cases.

**"Done when" gates.**
- New `nested-includes-distinct.test.ts` from dispatch 1 turns green.
- All other suites under the client package stay green.
- `pnpm --filter @prisma-next/sql-orm-client test` green.
- `pnpm typecheck` clean.
- `pnpm lint:deps` clean.

**Failure modes to avoid.**
- Forgetting to force-include grandchild join keys → grandchildren come back empty on `.select(...)` cases that omit the join key.
- Building the CTE shape only for `lateral` and not for `correlated` → correlated strategy still throws.

**Pre-flight gate.** Sizing risk: if the CTE lowering requires touching more than the three named functions, this dispatch is **L**, refuse and re-decompose.

## Dispatch 3 — Follow-up bookkeeping (S)

**Intent.** File the deferred Postgres `DISTINCT ON` optimization as a follow-up tech-debt ticket. Cross-link from `spec.md § Out of scope`.

**"Done when" gates.**
- Follow-up Linear ticket created and linked.

This dispatch is bookkeeping-only; it can happen in parallel with the PR landing.
