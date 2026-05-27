# Slice plan: SQL ORM single-query include aggregates

Companion to [`spec.md`](./spec.md). Three dispatches; each leaves the working tree green and ships an incrementally larger slice of the feature. PR opens after dispatch 3.

## Lead Linear issue & branch

- **Lead issue (branch + PR title prefix):** [TML-2595](https://linear.app/prisma-company/issue/TML-2595). The other ticket ([TML-2588](https://linear.app/prisma-company/issue/TML-2588)) closes by satisfaction in the same PR — referenced from PR body, not from branch. ([TML-2498](https://linear.app/prisma-company/issue/TML-2498) was initially in scope but reversed mid-slice; closed by the author as not-a-bug. See [`design-decisions.md`](./design-decisions.md) D1.)
- **Working branch:** `sql-orm-include-aggregates` (descriptive, matches the project folder; deviates from the lead-ticket-slug pattern because the slice closes multiple tickets in one PR).
- **Parent branch:** `origin/main` (orphan-style slice; no parent project working branch).

## Failure-mode references (from [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md))

Threaded into per-dispatch edge-case tables:

- **F3 — Discovery via test suite instead of grep.** All call sites of `hasScalarOrCombineIncludeDescriptors`, the planner throw, and the decoder throw are pre-named in the spec's § Scope. Briefs reference those names; implementer uses `rg` to confirm reach before running the test suite.
- **F4 — Feature-sized dispatch with no inspection cadence.** Each dispatch sized M-or-below; WIP-inspection cadence ≤ 5 min (per `drive-build-workflow`). If a dispatch overruns its time-box, re-decompose.
- **F5 — Destructive git operations executed by subagents.** Non-negotiable: every dispatch brief forbids `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree, without orchestrator approval.
- **Slice-shape scope trap — "fix on Postgres" leaks to "fix on all targets" mid-implementation.** Mitigated by the 3-dispatch sequencing: lateral first (Postgres), correlated explicitly second (SQLite). D1's brief states "do not touch `buildCorrelatedIncludeProjection`."

## Grep gates (from [`drive/calibration/grep-library.md`](../../drive/calibration/grep-library.md))

Cross-cutting, applied at every dispatch's DoD:

- `rg ': any\b|\bany\[\]' packages/3-extensions/sql-orm-client -g '*.ts'` — no new `any` usage.
- `rg '@ts-expect-error' packages/3-extensions/sql-orm-client -g '*.ts' -g '!*.test-d.ts'` — only allowed in `.test-d.ts`.
- `rg '@ts-nocheck' packages/3-extensions/sql-orm-client` — none.

Dispatch-specific grep gates appear in each dispatch's "Done when" section.

---

## Dispatch 1: Lateral scalar reducers

**Intent.** Extend `buildLateralIncludeArtifacts` to emit `count` / `sum` / `avg` / `min` / `max` as LATERAL subqueries with the appropriate aggregate function (`COUNT(*)`, `SUM(col)`, `AVG(col)`, `MIN(col)`, `MAX(col)`) over the refine's full state — `where`, `take`, `skip`, `orderBy`, `distinct` all compose through to the scalar scope. Modify `dispatchWithIncludeStrategy` to route lateral-strategy targets through single-query for scalar shapes (correlated-strategy still routes to multi-query — that's dispatch 3's job). Update `decodeIncludePayload` to handle scalar leaves (replace the per-node defensive throw with proper extraction). Lift the top-level planner throw in `compileSelectWithIncludeStrategy` for the scalar case. **Do not touch `combine()`.** **Do not touch `buildCorrelatedIncludeProjection`.**

_Note: D1 originally specified the aggregate over the where-filtered, unpaginated relation per the TML-2498 framing. Reversed mid-slice during PR review — the page-capped semantic is the natural composition; see [`design-decisions.md`](./design-decisions.md) D1._

**Files in play.**
- `packages/3-extensions/sql-orm-client/src/query-plan-select.ts` (extend `buildLateralIncludeArtifacts` + introduce a `buildIncludeChildScalarSelect` helper if cleaner; relax planner throw).
- `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` (modify dispatch gate to carve lateral-handles-scalar; extend `decodeIncludePayload` for scalar leaves).
- `packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts` (new SQL-shape unit tests).
- `packages/3-extensions/sql-orm-client/test/integration/<existing-or-new>.test.ts` (Postgres-side integration cases via PGlite).

**Edge cases covered by this dispatch.** From the spec's table:
- Bare count (`r => r.count()`)
- Count with where (`r => r.where(W).count()`)
- Count with where + take/skip → pagination composes through (assertion: LIMIT/OFFSET ENTER COUNT scope; `take(N).count()` returns ≤ N when the where-set is larger than N)
- `sum` / `avg` / `min` / `max` shapes
- Numeric semantics on bigint / decimal columns (no JS-side `Number` coercion)
- NULL / empty-relation behaviour for sum/avg/min/max (match today's JS-reducer return shape; flag if it was wrong)
- `orderBy` on a scalar refine is silently ignored at the SQL level
- Nested include with scalar at any depth (the recursive scan that gated this is unchanged in this dispatch; depth fans out naturally once the leaf works)

**Edge cases deferred.**
- `combine` (any branch) → dispatch 2.
- Any correlated-strategy shape → dispatch 3.
- Distinct + scalar interplay → dispatch 2 covers it inside the combine case.

**"Done when":**

- [ ] `pnpm typecheck` clean in `packages/3-extensions/sql-orm-client`.
- [ ] `pnpm test:packages -- @prisma-next/sql-orm-client` clean — including the new unit tests asserting SQL shape for each reducer.
- [ ] `pnpm test:integration` clean — Postgres scalar-include cases pass; the pagination-composes-through case (count with `where().take(N).count()`) returns the page-capped count (≤ N).
- [ ] `pnpm lint:deps` clean.
- [ ] Grep gates clean: no new `any`, no `@ts-expect-error` outside `.test-d.ts`, no `@ts-nocheck`.
- [ ] Dispatch-gate grep: `rg 'hasScalarOrCombineIncludeDescriptors' packages/3-extensions/sql-orm-client/src` still returns hits (the gate is *modified*, not removed yet) — confirms the carve was surgical, not a wholesale removal.
- [ ] Correlated-builder grep: `git diff origin/main -- packages/3-extensions/sql-orm-client/src/query-plan-select.ts | rg 'buildCorrelatedIncludeProjection'` returns no diff — confirms F-prefixed scope leak didn't happen.
- [ ] No SQLite integration test changes in this dispatch (correlated work is dispatch 3).
- [ ] Intent-validation: diff matches the intent above; no `combine` handling, no correlated changes, no `include-tree-predicates.ts` deletion.

**Size.** M. Estimated 4 files, ~180-240 LoC including tests.

**Model tier.** Opus (orchestrator tier). Judgment-heavy: SQL emission shape decisions, gate-carving, decoder logic. Per [`model-tier.md`](../../drive/calibration/model-tier.md) — "Substrate change / design judgment / spec interpretation."

**DoR confirmed:** ✓ (intent clear; files named; gates explicit; size M; failure modes threaded; F5 non-negotiable named).

---

## Dispatch 2: Lateral `combine()` packing

**Intent.** Extend `buildLateralIncludeArtifacts` to emit `combine({ branch1: ..., branch2: ... })` as a single LATERAL subquery whose projection is a `json_build_object` packing N branches (row-shaped and/or scalar-shaped). Modify the dispatch gate to carve lateral-handles-combine in addition to lateral-handles-scalar (still routing correlated combine to multi-query). Extend `decodeIncludePayload` to unpack the combine sub-object into branch-keyed values (each branch dispatches to either the existing row-decode path or D1's scalar-leaf path).

**Files in play.**
- `packages/3-extensions/sql-orm-client/src/query-plan-select.ts` (extend `buildLateralIncludeArtifacts` for combine; introduce `buildLateralCombineBranch` helper packing N branches).
- `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` (extend dispatch gate; extend `decodeIncludePayload` for combine sub-object).
- `packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts` (combine SQL-shape unit tests).
- `packages/3-extensions/sql-orm-client/test/integration/<existing-or-new>.test.ts` (Postgres combine integration cases).

**Edge cases covered by this dispatch.** From the spec's table:
- `combine({ rows: r.take(N), count: r.count() })` — the Pothos `totalCount` shape (TML-2595 worked example)
- `combine({ a: r.count(), b: r.sum('field') })` — multiple scalar branches
- `combine({ a: r.where(W1).count(), b: r.where(W2).count() })` — divergent where per branch
- `combine` containing a row branch with `distinct(cols)` — interplay with TML-2656's ROW_NUMBER lowering (the row branch keeps its existing lowering; the scalar branch sees the full unfiltered relation)

**Edge cases deferred.**
- Any correlated-strategy combine → dispatch 3.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- @prisma-next/sql-orm-client` clean — including new combine unit tests.
- [ ] `pnpm test:integration` clean — Postgres combine cases pass; query-execution count is 1 (not 1 + branch_count) per TML-2595's acceptance.
- [ ] `pnpm lint:deps` clean.
- [ ] Grep gates clean (no `any`, no `@ts-expect-error` outside `.test-d.ts`, no `@ts-nocheck`).
- [ ] Correlated-builder grep: `git diff origin/main..HEAD -- packages/3-extensions/sql-orm-client/src/query-plan-select.ts | rg 'buildCorrelatedIncludeProjection'` still returns no diff — confirms still no scope leak.
- [ ] D1's scalar tests still green (no regression on the scalar path that D2 builds on).
- [ ] Intent-validation: diff is `combine` packing only; no correlated changes; no gate removal beyond the carve.

**Size.** M. Estimated 4 files, ~150-200 LoC including tests. Smaller than D1 because the scalar building blocks and the gate-carving pattern are already in place; D2 reuses them.

**Model tier.** Opus (orchestrator tier). Despite the pattern being established by D1, combine carries unresolved design surface that may settle mid-implementation: (1) NULL/empty-relation handling location — `LEFT JOIN LATERAL` + parent-side `COALESCE` vs. LATERAL-internal NULL-handling vs. sentinel wrap; (2) branch-level WHERE reuse — N independent subqueries packed into `json_build_object` vs. one shared correlation scope with branch-specific filters; (3) the spec § Open Q 3 escape-hatch ("if the one-LATERAL shape proves awkward for the row+scalar mix, escalate"). Per [`model-tier.md`](../../drive/calibration/model-tier.md)'s explicit non-fit row — "Dispatches where the design must settle mid-implementation" route to orchestrator tier rather than mid-tier. Demote to Sonnet only after a pre-D2 design-discussion pins the three questions (option not taken; orchestrator-tier accepts the cost instead).

**DoR confirmed:** ✓ (depends on D1's gate-carve and scalar-decoder shape; D1's "Done when" guarantees that state).

---

## Dispatch 3: Correlated mirror + lift remaining gates + delete dead predicate

**Intent.** Mirror dispatches 1 + 2 into `buildCorrelatedIncludeProjection`: scalar reducers as correlated subqueries returning the aggregate scalar; `combine()` as a correlated subquery returning `json_build_object` (or SQLite's `json_object`) packing N branches. With correlated now supporting the same shapes as lateral, the dispatch gate becomes fully redundant — remove it, remove the defensive throw in `decodeIncludePayload`, and delete `include-tree-predicates.ts` (its sole consumers go away in this dispatch). The `'multiQuery'` arm of `selectIncludeStrategy` stays (TML-2657 territory).

**Files in play.**
- `packages/3-extensions/sql-orm-client/src/query-plan-select.ts` (extend `buildCorrelatedIncludeProjection` for scalar + combine; remove the planner throw if not already lifted in D1+D2).
- `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` (remove `hasScalarOrCombineIncludeDescriptors` import + dispatch gate; remove the defensive decoder throw — the recursion now handles all cases natively).
- `packages/3-extensions/sql-orm-client/src/include-tree-predicates.ts` (**delete file**).
- `packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts` (correlated-side SQL-shape tests for scalar + combine; remove the planner-rejection test cases that asserted the throw).
- `packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts` (remove the dispatch-gate cases that asserted scalar/combine routes to multi-query; replace with single-execution dispatch assertions for the same shapes on both strategies).
- `packages/3-extensions/sql-orm-client/test/integration/<existing-or-new>.test.ts` (SQLite scalar + combine integration cases).

**Edge cases covered by this dispatch.** From the spec's table:
- All correlated-strategy variants of every Handle row from D1 + D2.
- Cleanup-side: the dispatch-gate tests and planner-throw tests get *repurposed*, not deleted — per the spec's § Scope rewrite note. Each removal/repurposing decision is justified in the PR description.

**Edge cases NOT touched by this dispatch.**
- Multi-query path itself (`dispatchWithMultiQueryIncludes`, stitchers, `compileRelationSelect`, `'multiQuery'` arm of `selectIncludeStrategy`) — TML-2657.
- Polymorphic-target includes — TML-2683.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- @prisma-next/sql-orm-client` clean — including new correlated unit tests + the repurposed dispatch-gate tests.
- [ ] `pnpm test:integration` clean across **both** Postgres (PGlite) **and** SQLite (correlated capabilities + adapter unit tests) — full TML-2595 + TML-2588 acceptance criteria met on both targets.
- [ ] `pnpm lint:deps` clean.
- [ ] Grep gates clean (no `any`, no `@ts-expect-error` outside `.test-d.ts`, no `@ts-nocheck`).
- [ ] Deletion gate: `rg 'hasScalarOrCombineIncludeDescriptors' packages/` returns zero hits — predicate fully gone, no lingering imports.
- [ ] Deletion gate: `rg 'include-tree-predicates' packages/` returns zero hits — file deletion clean, no stale imports.
- [ ] Multi-query path preservation: `rg 'dispatchWithMultiQueryIncludes' packages/3-extensions/sql-orm-client/src` still returns hits — confirms TML-2657's deletion scope was not opportunistically pulled in.
- [ ] `'multiQuery'` strategy arm preservation: `rg "'multiQuery'" packages/3-extensions/sql-orm-client/src` still returns hits — same.
- [ ] Intent-validation: diff is correlated builder + gate removal + predicate deletion + test repurposing. No multi-query path code is touched.

**Size.** M. Estimated 5-6 files (most additions in correlated builder + tests; one file deletion; small edits to dispatch + decoder). ~180-230 LoC excluding the deleted predicate file. Larger than D2 but the cleanup work is mechanical and the correlated builder mirrors lateral's pattern.

**Model tier.** Sonnet (mid tier). The pattern is fully established by D1 + D2; the correlated builder is a mirror, the cleanup is mechanical. Per [`model-tier.md`](../../drive/calibration/model-tier.md) — "Architect-class finding remediation (single discipline, narrow surface) with composer-2.5 when the brief is precise and a sibling dispatch already established the pattern" — could even be composer-2.5 if D1 and D2's diffs come out clean and the pattern is uncontroversial.

**DoR confirmed:** ✓ (depends on D1's gate-carve shape + D2's combine SQL shape; both guarantee the state this dispatch needs to mirror).

---

## Sequence + dependencies

```
D1 (lateral scalars, ~M)
   ↓
D2 (lateral combine, ~M; reuses D1's scalar leaves + gate-carve pattern)
   ↓
D3 (correlated mirror + cleanup, ~M; mirrors D1+D2 into correlated builder, removes gate)
   ↓
[PR opens — slice-DoD walkthrough, then drive-pr-description]
```

Sequential, no parallelism within slice. Each dispatch's "Done when" includes the previous dispatches' tests still being green (regression invariant).

## Slice-DoD mapping

Each item from the spec's § Slice Definition of Done is reachable from this dispatch sequence:

- **SDoD1** (CI gates) — reached at the end of D3 (all gates green across both targets).
- **SDoD2** (every pre-named edge case handled) — D1 handles 8 cases, D2 handles 4 cases, D3 handles correlated mirrors of all 12 + the cleanup-side edge cases.
- **SDoD3** (acceptance criteria of TML-2595 / TML-2588) — partially met after D2 (Postgres only); fully met after D3 (both targets). _(TML-2498 was reversed and closed as not-a-bug; no longer a SDoD3 sub-item.)_
- **SDoD4** (manual-QA N/A with rationale) — non-procedural; already documented in spec.
- **SDoD5** (anti-corruption: no out-of-scope surfaces touched) — enforced by per-dispatch grep gates (correlated-builder grep in D1+D2; multi-query path preservation grep in D3).
- **SDoD6** (PR description references all three closed tickets + TML-2657 follow-up + illustrative SQL snippets) — D3's PR-opening step.

## Open questions surfacing during execution

If any of these is observed mid-dispatch, halt and re-enter `drive-discussion` per invariant I12; do not silently amend the plan:

1. **NULL/empty-relation return shape** (spec § Open Q 2). Surfaces in D1 when wiring up sum/avg/min/max tests. Working position: match today's JS-reducer shape. Falsifies if today's shape is observably wrong; then `drive-discussion` decides whether to fix here or in a separate slice.
2. **`combine` SQL shape — one LATERAL with one `json_build_object` vs N LATERALs** (spec § Open Q 3). Surfaces in D2's lateral combine implementation. Working position: one LATERAL per combine.
3. **LATERAL-vs-correlated scope creep guard** (spec § Open Q 4). Watch in D3 when both builders are open simultaneously. If a benchmark-worthy observation surfaces, record it to `projects/sql-orm-include-aggregates/design-decisions.md` (create the file if it doesn't exist) and continue — do not collapse builders inside this slice.
4. _(resolved — mid-slice)_ **TML-2498 urgency re-check** (spec § Open Q 1). Reversed during PR self-review: the framing was a misreading. Ticket closed as not-a-bug. See [`design-decisions.md`](./design-decisions.md) D1.

## Open items

Decisions taken mid-slice that produce downstream work, recorded here for traceability:

1. **Bigint precision via codec routing — deferred to [TML-2684](https://linear.app/prisma-company/issue/TML-2684) (filed Medium).** Surfaced in D1 R1 review. D1 ships scalar reducers via a `json_build_object('value', AGG(...))` LATERAL envelope, unwrapped by `decodeScalarIncludePayload` via the existing `parseIncludedRows → JSON.parse` pipeline. The spec's literal "no JS-side `Number` coercion truncation" promise holds via structural defence (no explicit `Number()` cast on the scalar return path); the spec's broader "codec layer decodes via the column's declared codec" framing is **not** met. Trade-off accepted with these grounds: (a) the JSON-envelope path is correct for counts within JS-safe-integer range and for sum/avg over `int4`, which covers the vast majority of practical cases; (b) the prior multi-query stitcher also used JS-side reducers without codec routing, so D1 does not regress anything; (c) decimal-precision questions cross-cut root-level `aggregate()` decoding too, which is a bigger codec-routing question better tackled as its own work item. TML-2684 captures the codec routing + bigint/decimal fixture extension as a coupled followup, blocked by this slice merging.

2. **Integration-test suite stability — out-of-scope team ticket recommended.** Surfaced in D1 R1 review. `pnpm test:integration` workspace-wide exhibits pre-existing PG portal-cleanup races (signature: `portal "C_X" does not exist`, non-overlapping fail-sets across re-runs) unrelated to this slice's touch surface. D1's touched scalar tests in `include.test.ts` are stably green in isolation (47/47). Not a slice-DoD blocker; the team should file a separate suite-stability investigation ticket. **Not filed by this slice's orchestrator** — the work isn't in this slice's family; whoever picks up suite-stability separately is the right author.

## Post-slice handoff

After D3 merges:
- TML-2595 / TML-2588 auto-close on merge (via `Closes:` lines in the PR body). TML-2498 was already closed by the author as not-a-bug mid-slice (see [`design-decisions.md`](./design-decisions.md) D1).
- TML-2657 unblocks: its "blocked by TML-2595" relationship is satisfied; ready to pick up.
- TML-2683 stays blocked by TML-2657 per its own sequencing.
- TML-2684 unblocks: ready to pick up (codec routing + bigint/decimal fixture extension).
