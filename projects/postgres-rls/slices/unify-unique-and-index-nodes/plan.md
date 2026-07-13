# Slice 2.6 — dispatch plan (rebuilt)

Spec: [`spec.md`](./spec.md). Design (authority): [`design.md`](./design.md). Branch: `slice/unify-unique-and-index-nodes`, reset to `origin/main` (`05b915f20`). The prior 24-commit attempt (merge unique into index + a `constraint` marker + dedupe + fail-loud + satisfaction machinery) was discarded: it violated the plan's own principle by merging two distinct schema elements into one node, which forced tree-massaging back in. This rebuild does the small, correct thing.

## The principle (from the operator, non-negotiable)

One schema-IR node per schema element. The differ compares two derived trees structurally and does **nothing else** — no pre-diff transformation, no dedupe, no reconciliation. A unique constraint (`pg_constraint`) and an index (`pg_index`) are different elements and stay two nodes (`SqlUniqueIR`, `SqlIndexIR`), exactly as PK/FK/check are already separate nodes.

## One dispatch (this is a small, deletion-dominated slice)

The whole slice is one coherent outcome — delete the reconciliation, keep the two nodes, fold FK resolution into derivation, rewrite the satisfaction tests. It does not decompose into independent hand-offs; splitting it would create red intermediate states (deleting the pass without rewriting the tests leaves suites red). One dispatch, persistent implementer.

**Outcome:** `diffSchemas(expected, actual)` runs on the trees as derived, with no pre-diff pass; `SqlUniqueIR` and `SqlIndexIR` are two clean structural nodes; a unique-vs-index mismatch is drift (missing + extra); the satisfaction cases fail per the design's behaviour table; the general extra-tolerance grading is byte-unchanged.

**The concrete change list (design §"The whole slice"):**
1. Delete `resolveSemanticSatisfaction` / `normalizeFlatActualForDiff` / `SemanticSatisfaction*` and their call sites in both `diff-database-schema.ts` (Postgres + SQLite). Delete `diff-tree-normalization.ts`.
2. Delete the caller-less `isUniqueConstraintSatisfied` / `isIndexSatisfied` from `sql-schema-diff.ts` + the `exports/diff.ts` entries (grep-confirm no callers).
3. `SqlIndexIR.isEqualTo` → symmetric on `unique`: `this.unique === node.unique && this.type === node.type && indexOptionsLooselyEqual(this.options, node.options)`. Keep the options-loose-compare and the introspection-side btree→undefined `type` normalization. `SqlUniqueIR` unchanged (id-identity).
4. Fold `neutralizeFlatExpectedFkSchemas` into `contractToSchemaIR` via a target-agnostic flatten option (SQLite passes it; Postgres doesn't — it re-resolves FK namespaces downstream); delete the pre-diff FK pass and the `fk-schema-normalization.ts`/`diff-tree-normalization.ts` home. No `if (sqlite)` in shared code (`no-target-branches`).
5. Leave `SqlUniqueIR`, `SqlIndexIR` (otherwise), the table node's `uniques`+`indexes` children, and both planners' `mapUniqueNodeIssue`/`mapIndexNodeIssue` exactly as on `origin/main`.
6. Rewrite the satisfaction tests to the structural behaviour: verdict suite §uniques/indexes/semantic-satisfaction (the satisfaction cases now fail; the round-trip stays clean), `planner.semantic-satisfaction` (mismatches now emit reconcile ops / grade per policy instead of zero-op "satisfied"), and any sqlite issue-planner satisfaction assertions. Add the FK-fold derivation test.

**Explicitly NOT done** (design §"Explicitly NOT in this slice"): no node merge, no `constraint` marker, no dedupe, no fail-loud rule, no `isSuperfluousConstraintOnlyNotEqual`/`isBareUniqueIndexExtra`/classifier special-case.

**Behaviour flips** (intended): contract `@@unique` vs live unique index → fail; contract `@@index` vs live unique constraint → fail; stray unique index → strict-only extra; `@@unique` round-trip → clean. Fence: `schema-verify.ts` changes only by removing satisfaction call sites — the general strict/lenient extra grading, control-policy disposition, and cross-space ownership are untouched (prove via `git diff origin/main -- schema-verify.ts`).

## Gate

build, forced typecheck, whole Lint job (lint:deps, lint, lint:casts, framework-vocabulary ratchet, `check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD)`), fixtures:check (expected clean — no example encodes a now-failing drift shape; a moving fixture is a real drift to surface), test:packages + test:integration + test:e2e, the four multi-space guards. Grep-clean: `resolveSemanticSatisfaction`, `normalizeFlatActualForDiff`, `diff-tree-normalization`, `fk-schema-normalization`, `isSuperfluousConstraintOnlyNotEqual`, `isBareUniqueIndexExtra`, `constraint` marker on the index node — all zero. Clear `~/.cache/pn-journey/tarballs` before integration/e2e if journeys fail with missing-method errors.

## Review

Persistent Opus reviewer, one pass: verify the differ runs untransformed, the two nodes are clean structural nodes, the FK-fold is byte-neutral (FK verdict tests unchanged), the behaviour flips are correctly pinned, and the extra-tolerance fence held.
