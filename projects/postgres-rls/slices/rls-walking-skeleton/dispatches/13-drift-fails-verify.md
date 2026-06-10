# Dispatch D13 — drift fails verify (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. Resolves review **F02** with slice 1's blunt rule: **any non-empty `extensionIssues` ⇒ the verify verdict the operator sees is a failure, naming the drifted policy.** Per-variation severity/grading is slice 2 — do NOT build dispositions here.

## Task

1. **Read the verdict paths first** (review §F02 cites them): family `verifySchema` assembly (`packages/2-sql/9-family/src/core/control-instance.ts` ~688-694, where `extensionIssues` is attached); CLI `db-verify.ts` (derives ok from `schema.counts.fail`); `combineSchemaResults` (okAll from members' `result.ok` — threading already done in D12).
2. **Wire bluntly:** when `extensionIssues` is non-empty — (a) the family-level result's `ok` is false; (b) the CLI `db verify` verdict is a failure (wherever it recomputes from `counts.fail`, account for `extensionIssues.length` too — pick the minimal correct seam after reading); (c) the rendered failure output **includes each extension issue's `message`** (which names the policy + namespace) so the operator sees *what* drifted, not just a red exit.
3. **Tests (behavior-phrased):** (a) family-level — a verify result with one extension issue has `ok: false`; (b) CLI-operation-level — the db-verify result for a drifted DB is a failure whose output/render includes the policy's wire name (use the existing PGlite harness from `rls-verify-extension-issues.integration.test.ts` and extend it through the CLI operation seam if reachable; if the CLI operation genuinely can't be driven from the test harness without a live-DB CLI spawn, assert at the deepest reachable seam and report exactly where the gap is); (c) update the existing clean-path tests if the field/verdict coupling changes their fixtures.

## Gates (run once, foreground)

`pnpm build` → workspace `pnpm typecheck` (keep it green — the D12 lesson) → the new tests + the two RLS verify/walking-skeleton integration tests still green → `pnpm lint:deps` → SQLite + Mongo suites green (their `extensionIssues` are always `[]`, so their verdicts must be unchanged — confirm no behavioral change for non-Postgres targets).

## Halt conditions

- Folding into the verdict requires changing the meaning of `counts` (pass/warn/fail node counts) in a way that breaks the verification-tree invariants — surface the design question instead of forcing it.
- The CLI seam can't see `extensionIssues` without re-plumbing beyond D12's threading — surface.

## Constraints

Explicit-staging commit, `tml-2868:` prefix, no amend, no push. No `any`/bare casts. Transient-ID scan. Heartbeats. Commit your own work; low budget → commit-partial + report.
