# Dispatch D11 — re-point the PSL e2e onto the production lowering

Slice `rls-walking-skeleton` (TML-2868), dispatch 11 (final). Implementer tier: sonnet. Builds on D10 (`27d31683c` — production PSL→IR lowering). **Closes AC6 + AC7: the slice DoD.** Small, mechanical. Commit your own work.

## Task

`packages/3-targets/6-adapters/postgres/test/migrations/rls-walking-skeleton-psl.integration.test.ts` currently simulates the PSL→contract lowering (test-local `lowerExtensionBlocksToRlsPolicies` helper + a custom `createNamespace` that splices in pre-lowered policies + a hand-built `PostgresRole`). D10 made the production lowering real. Re-point the test:

1. **Delete the hand-lowering** — remove `lowerExtensionBlocksToRlsPolicies`, the custom splice-in `createNamespace`, and the hand-built `PostgresRole`. Call `interpretPslDocumentToSqlContract` with the assembled contributions + the production `postgresCreateNamespace` (mirror D10's unit test in `psl-policy-authoring.test.ts`, which does exactly this).
2. **Keep everything downstream identical** — plan vs empty schema (`CREATE TABLE` + `ENABLE RLS` + `CREATE POLICY`), apply to PGlite, harness `CREATE ROLE app_user` + `GRANT SELECT`, `SET ROLE` + `set_config('app.uid','101')` → **only the owner row**, `RESET ROLE`, `introspect()` + verify → `extensionIssues: []`.
3. **Role note:** the contract no longer carries a hand-built `entries.role` entry (role *authoring* is slice 4; the policy's `roles` are plain name strings; the DB role is harness-created). If dropping the role entry makes verify report drift (an `extra`/`missing` role issue — i.e. roles are being diffed), **surface that to the orchestrator** rather than re-adding the hand-built role or changing production code — it's a scoping question.

## Completed when (AC6 — the genuine headline)

- [ ] The e2e proves, in one test with **zero test-side lowering**: authored PSL string → production interpreter → contract → plan → apply → RLS filters rows → re-verify clean.
- [ ] Gates (run once, foreground): the re-pointed test; adapter + target-postgres typecheck; `pnpm lint:deps`; `pnpm fixtures:check` clean; SQLite + Mongo suites green. (The 4 pre-existing `it.fails` in `planner.reconciliation.integration.test.ts` are expected — ignore.)

## Halt conditions (surface)

- The production-lowered contract behaves differently from the hand-lowered one anywhere downstream (plan ops, filtering, verify) — a real join bug; surface with diagnosis.
- Dropping the hand-built role surfaces verify drift — surface (scoping question, not yours to decide).

## Constraints

Explicit-staging, `tml-2868:` prefix, no amend, **no push**. Test-only change (no production code). Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`.

## References

- D10's unit test (the wiring to mirror): `postgres/test/psl-policy-authoring.test.ts` — the `interpretPslDocumentToSqlContract policy_select → entries.rlsPolicy` case.
- The e2e to re-point: `6-adapters/postgres/test/migrations/rls-walking-skeleton-psl.integration.test.ts`.

## Operational metadata

- **Model tier:** sonnet — delete a helper, swap in the production call, re-run.
- **Time-box:** ~40 min. Overrun → commit-partial + report.
