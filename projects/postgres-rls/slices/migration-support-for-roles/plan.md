# Slice 4 — dispatch plan

Spec: [`spec.md`](./spec.md). Branch: `slice/migration-support-for-roles` (off `main` at slice-3 tip `1aae13583`). Three dispatches, sequential, persistent Sonnet implementer + Opus reviewer. Tests-first throughout.

**Why land-handling-then-flip (not flip-then-handle):** roles are already introspected and projected onto the root; the only thing withholding them from the diff is `children()`. So flipping `children()` first would immediately route real role issues into a planner that fails loud on them and a verdict that mis-grades extra roles under managed. Instead: W1 lands the planner-filter + verdict-exemption **unconsumed** (no role issues exist until W2, so they're inert no-ops, tested via directly-constructed role issues); W2 flips `children()` and the real diffs flow correctly on the first try; W3 proves end-to-end + closes.

Per-dispatch gate (from [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)): build where typed exports change, forced typecheck, per-package `pnpm lint`, scoped `--filter` suites, `fixtures:check` when emission-adjacent, `lint:deps`, vocabulary ratchet.

## W1 — Role-issue handling, unconsumed (planner filter + verdict exemption)

**Outcome:** two pieces of role handling land while roles are still absent from the diff, so both are inert no-ops proven by directly-constructed role diff issues:
1. **Planner: role issues map to zero ops.** In `planner.ts`'s issue partitioning (`isPolicyDiffIssue` split, ~:188), role diff issues get a third disposition beside `policyDiffIssues`/`relationalDiffIssues` that produces **no** ops — they must never reach `mapNodeIssueToCall` (whose default is the unsupported-operation fail-loud). Test: a directly-constructed `not-found` and `not-expected` role issue through the planner yields zero role ops and does not throw.
2. **Verdict: `not-expected` roles are tolerated under every control policy.** In the SQL-family verdict filter (`schema-verify.ts` `computeSqlDiffVerdict`/`classifySqlDiffIssue`), a `not-expected` issue whose node-kind granularity marks it a role-class structural node is unconditionally tolerated (never fails, even under `managed`-strict) — expressed through the family's node-kind classification seam, **not** a target import (if the family can't currently express "this structural kind's extras are always tolerated," widen the classification seam minimally; do not import a Postgres kind into 2-sql). `not-found` role → `declaredMissing` → fail is already generic; add a test pinning it reaches the fail verdict under `external` and `managed`. Test: directly-constructed `not-expected` role issue → tolerated under managed + external; `not-found` role issue → fail under both.

**Grounding to resolve here:** does authoring already guarantee every role a `policy_*` references is a declared `PostgresRole` (so it becomes a role node)? If yes, the role-node existence check is the complete policy→role verify. If no, an undeclared-role reference would slip past — **stop and surface** (don't silently add authoring validation; it may reshape the slice).
**Behaviour-neutral:** no role issues exist yet, so nothing changes in any real plan/verify. Non-role suites green untouched.
**Completed when:** the two handlers are proven by constructed-issue unit tests; `fixtures:check` clean; scoped suites green; grounding question answered (in the report).

## W2 — The flip: roles enter the diff

**Outcome:** `PostgresDatabaseSchemaNode.children()` yields roles **before** namespaces; role node `id()` becomes collision-safe (a role-qualified id that cannot equal a namespace/schema id in the flat sibling map); the `postgres-database-schema-node.test.ts` "children excludes roles" assertion is inverted to pin roles-present-and-first. Real role diffs now flow through W1's handling: declared-absent → fail, live-undeclared → tolerated, zero ops, role issues ordered ahead of policy issues.
- Collision-safe id (D1): a role and a same-named schema now diff without the duplicate-id throw — pin it.
- Ordering (D4): role issues precede namespace/table/policy issues — pin by asserting order.
- Blast radius: any existing test asserting root-children or issue-order shifts (roles now lead) — update expectations to the new truth, not around it.
**Completed when:** AC-1/AC-3/AC-4 pinned at the node/differ level + a PGlite introspect-vs-contract integration test showing a missing declared role fails and an extra live role is clean; golden `plan()` diff byte-identical (AC-5); non-role planner suites unchanged; multi-space guards green.
**Hands to W3:** role behavior is final; only e2e + gate remain.

## W3 — Skeleton e2e, golden diff, full gate

**Outcome:** the Supabase walking-skeleton e2e proves AC-2 end-to-end against live PGlite — a declared role missing from the database (fresh DB or dropped role) fails `db verify` naming the role; a present role verifies clean. Golden `plan()` diff re-confirmed byte-identical (roles add zero ops). Any construction-site ripple from the id change swept. Full slice gate.
**Completed when:** full gate green — build, forced typecheck, whole Lint job (incl. vocabulary ratchet unchanged), `fixtures:check`, `test:packages` + `test:integration` + `test:e2e`, multi-space guards, `check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD)`; slice-DoD checklist walked; `origin/main` synced before final validation + push.

## Sequencing & handoffs

`W1 → W2 → W3`, strictly. W2 builds on W1 (the handling must exist before roles flow). W3 consumes W2 (e2e of the landed behavior).

## Known blast radius (from grounding)

- `postgres-database-schema-node.test.ts` "children excludes roles" test **inverts** (W2).
- Any root-children / issue-order assertions across postgres-target + integration tests shift as roles lead the child list (W2).
- The verdict-filter change touches `packages/2-sql/9-family` — re-run the family verify suites + the multi-space guards (W1/W2).
- No contract/emitter change → `fixtures:check` should stay green throughout (roles already serialize); a red there means something leaked.

## Linear

Slice 4 needs a **new top-level ticket** (sibling of TML-2869 with a blocks/blockedBy chain, not a sub-issue) — **operator's to create**. Blocking chain per project plan: TML-2869 → ⟨slice 4⟩ → TML-2870 (slice 5).
