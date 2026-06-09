# Dispatch D9 — PSL-authored walking-skeleton e2e (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 9 of 9 (added after the D8 operator escalation: prove the vertical with PSL at the top). Implementer tier: sonnet. Builds on D4 (PSL `policy_select`) + D6 (plan) + D7 (verify) + D8 (the IR-built spine harness to mirror). **This closes AC6's headline: developer authors PSL → rows filtered.** Commit your own work.

## Task

Add an integration test that drives the walking skeleton **from a PSL string** (not hand-built IR), proving the full author→filter chain end-to-end. Scoping (already confirmed feasible — CHEAP): `interpretPslDocumentToSqlContract` from `@prisma-next/sql-contract-psl` (already a dependency of the postgres adapter; layering allows the import) turns a PSL string into a contract when given the Postgres pack's authoring contributions.

New test under `packages/3-targets/6-adapters/postgres/test/migrations/` (reuse the PGlite harness + flow from the existing D8 `rls-walking-skeleton.integration.test.ts`; `test.execArgv = ['--no-memory-protection-keys']`). Flow:

1. **PSL → contract.** `parsePslDocument({ schema: <PSL string>, sourceId })` then `interpretPslDocumentToSqlContract({ document, target: <postgres target ref>, scalarTypeDescriptors: <the real postgres scalar descriptors — find them, do NOT hand-roll a fake map>, authoringContributions: { entityTypes: postgresAuthoringEntityTypes, pslBlockDescriptors: postgresAuthoringPslBlockDescriptors }, composedExtensionContracts: new Map() })`. PSL: one `namespace public` with `model profile { id Int @id; owner_id Int }`, `role app_user`, `policy_select p_read { target = profile; roles = [app_user]; using = "owner_id = current_setting('app.uid')::int" }`. Assert `result.ok` and that `entries.rlsPolicy` has the lowered `PostgresRlsPolicy` (sanity).
   - **Find the real scalar descriptors / target ref** the Postgres pack uses (grep existing PSL→contract or emit tests; the postgres codec registry / descriptor-meta). If assembling them is more than a few lines, mirror whatever an existing Postgres PSL-interpret/emit test does. If genuinely not reachable cleanly, **halt and surface** (the scout said it's cheap — expect it to be).
2. **Plan → apply → filter → re-verify** — identical to the D8 spine: plan against empty schema (assert `CREATE TABLE` + `ENABLE RLS` + `CREATE POLICY`), apply ops to PGlite, `CREATE ROLE app_user`, `GRANT SELECT`, `SET ROLE app_user` + `set_config('app.uid','101')`, `SELECT * FROM profile` → **only the owner row**, `RESET ROLE`, then `introspect()` + verify → `extensionIssues: []`.

This may **replace** the D8 IR-built test or sit **beside** it — your call; the PSL-authored one is the headline (prefer replacing if the IR-built one becomes redundant, but keep coverage of the introspection/verify path).

## Completed when (closes AC6 with PSL at the top)

- [ ] The PSL-authored e2e passes: PSL string → contract → plan → apply → `SET ROLE` → only owner row → re-verify `extensionIssues: []`.
- [ ] Gates (run once, foreground): the new test; target-postgres + adapter typecheck; `pnpm lint:deps`; `pnpm fixtures:check` clean; SQLite + Mongo suites green. (The 4 `it.fails()` in `planner.reconciliation.integration.test.ts` are expected pre-existing — ignore.)

## Standing instruction

Drive the real path — PSL interpret + real planner/verifier, no stubs. If PSL→contract produces a policy that differs from what the IR-built spine used (a join bug between D4 lowering and D6/D7), that's a real finding — surface it.

## Halt conditions

- The Postgres scalar descriptors / target ref needed by `interpretPslDocumentToSqlContract` aren't reachable from the adapter test without disproportionate wiring — surface (contradicts the scout; report what blocked).
- PSL→contract yields a different `PostgresRlsPolicy` than the IR path (join bug) — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work.

## References

- **Authoritative:** slice spec §6-I (the spine) + §1 (the vertical). Entry point: `interpretPslDocumentToSqlContract` (`@prisma-next/sql-contract-psl`); pattern: `2-sql/2-authoring/contract-psl/test/interpreter.extensions.test.ts` (interpret call) + `postgres/test/psl-policy-authoring.test.ts` (parse + Postgres contributions) + the D8 `rls-walking-skeleton.integration.test.ts` (PGlite plan/apply/verify harness).
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — wire PSL→contract into the existing spine harness + assert.
- **Time-box:** ~60 min. Overrun → halt and surface.
