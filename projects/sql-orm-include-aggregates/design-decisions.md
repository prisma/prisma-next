# Design decisions

Decisions taken mid-slice that amended the spec or changed implementation direction in load-bearing ways. Per invariant I12, falsified-assumption triggers record their resolution here before the spec/plan/implementation are amended.

## D1 — TML-2498 framing reversed; `take(n).count()` returns ≤ n

**Date:** 2026-05-27 (during D3 R1 review of PR #596)

**Trigger.** Falsified assumption (I12). The slice was filed and specified to "fix TML-2498's silent count miscount under `take` / `skip`" by emitting the aggregate over the where-filtered, **unpaginated** relation — the spec's edge-case row promised LIMIT/OFFSET would NOT enter the COUNT scope, and `buildIncludeChildScalarSelect` was structurally built to enforce that by construction (no `withLimit` / `withOffset` calls in the scalar inner SELECT).

During PR self-review, the PR author re-read TML-2498's ticket text and concluded its framing was wrong. The natural compositional semantic of `db.orm.user.include('posts', p => p.where(W).take(10).count())` is "count the rows that survive the chain" — i.e. **≤ 10**. The page-capped behaviour TML-2498 described as a "silent miscount" is the correct compositional output; calling it a bug was the misreading.

**Decision reached.** Reverse the semantic. The slice will:

- Apply `take` / `skip` / `orderBy` / `distinct` from the refine's `state` to the scalar inner SELECT (i.e. compose through to the aggregate scope).
- Apply the same to combine scalar branches — each branch's pagination composes through to its own aggregate scope.
- Close TML-2498 as won't-fix / not-a-bug (done by the author in Linear; the ticket text was always wrong, not the implementation).
- Drop the TML-2498 close-line from the PR; the PR continues to close TML-2595 + TML-2588.
- Rename / re-orient the unit and integration tests that asserted the unpaginated-total invariant — the new invariant is "pagination composes through to scalar aggregates."

**Why this reading is the right one.**

- **Compositional intuition.** Refine methods are pipeline stages: each operates on the previous's output. `take(10)` returns ≤ 10 rows; `count()` counts those rows. Treating the chain as anything else means the chain has hidden non-compositional behaviour that's not derivable from the method signatures.
- **The "but I want the unpaginated total" use case is already served.** Drop the `take` entirely (`p.where(W).count()` returns the full where-filtered count), or use `combine({ page: p.where(W).take(10), total: p.where(W).count() })` to get both. The page-capped count under `take(n).count()` is not a footgun; it's the only sensible composition.
- **Pothos use case (TML-2595) still works.** The Pothos `combine({ recent: r.take(N), count: r.count() })` shape composes the way Pothos wants by construction — `recent` carries the take, `count` doesn't. That's exactly what the user types; no hidden re-routing required.
- **TML-2498's own ticket text contradicted itself in retrospect.** It described the page-capped behaviour as "silent miscount" without articulating *why* the user would expect unpaginated. The unpaginated-total expectation only makes sense if you assume the user wrote `take` to scope the row-fetch but somehow expected the aggregate to ignore that. That's an unintuitive default and the wrong one to encode.

**Affected artefacts.**

- `projects/sql-orm-include-aggregates/spec.md`:
  - § Edge cases table: the TML-2498 row inverts. Pagination composes through; the unpaginated-total expectation is dropped.
  - § Approach: the "LIMIT not applied" callout under the lateral scalar SQL shape is reversed — LIMIT/OFFSET are applied per the refine's state.
  - § Slice Definition of Done § SDoD3: the TML-2498 acceptance bullet is removed (the ticket is closed as not-a-bug; nothing to satisfy).
  - § References § Linked tickets: TML-2498 stays as "related" but moves out of "closed by this slice."
- `projects/sql-orm-include-aggregates/plan.md`:
  - D1 § Edge cases covered: the "TML-2498 case" item inverts (now: pagination composes through).
  - § Slice-DoD mapping: SDoD3 sub-bullet for TML-2498 removed.
  - § Open questions surfacing during execution: Open Q 1 (TML-2498 urgency re-check) is moot.
  - § Open items: TML-2498 deferral note remains as context, but framed as "ticket closed as not-a-bug" rather than "deferred to followup."
- `packages/3-extensions/sql-orm-client/src/query-plan-select.ts`:
  - `buildIncludeChildScalarSelect`: add `withLimit` / `withOffset` / `withOrderBy` per the refine's `state`. (Plus equivalent for distinct lowering if it applies — verify during implementation.)
  - `buildIncludeChildCombineBranchSelect`: same for scalar branches inside combine.
- Tests (unit + integration):
  - Unit assertions for "LIMIT and OFFSET do not enter COUNT scope" → reverse / rename.
  - Integration test "TML-2498: ... returns the unpaginated total" → reverse to a "pagination composes through" test, asserting `count = take(n)` when the where-set is larger than n.
  - Same for the correlated mirror tests.
- PR #596 description (`wip/pr-body.md`):
  - Drop the TML-2498 close-line.
  - Rewrite § At a glance — the TML-2498 illustrative test is no longer the headline (the test changes meaning); pick a different concrete demonstration of the slice's value (combine with multi-strategy single-query, probably).
  - § Notes for the reviewer: remove the TML-2498 framing.
  - § Alternatives considered: add the reversal as an entry (we considered the unpaginated-total semantic from the original ticket; reversed during review).
- Linear:
  - TML-2498: closed by the PR author as won't-fix / not-a-bug. No further action.
  - TML-2595 + TML-2588: continue to close on merge.
  - TML-2657 / TML-2683 / TML-2684: unaffected.

**Implementation sequencing.** This amendment lands as part of the same PR (#596). The implementer round addressing PR review actions A01–A05 covers it: A05 morphs from `wont_address` (defer per spec) to `will_address` (reverse the semantic per amendment); the code change is the SQL emission shape adjustment + the test reversals. The orchestrator commits the spec/plan/PR-body amendments before the implementer runs so the implementer brief references the post-amendment state.
