# Dispatch D8 — walking-skeleton integration test (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 8 of 8 (last). Implementer tier: sonnet. Builds on D2–D7 (the whole new path). **Proves AC6 — the slice's spine.** Commit your own work; if low on budget, commit what compiles + report remaining.

## Task

Write the end-to-end PGlite integration test that proves a developer-authored RLS policy filters rows, threaded through the new architecture. Authoritative detail: **slice spec §6-I**. Mirror `packages/3-targets/6-adapters/postgres/test/migrations/cross-namespace-fk.integration.test.ts` for PGlite startup, the `plan()` call, and applying ops (`test.execArgv = ['--no-memory-protection-keys']`). New test file under `packages/3-targets/6-adapters/postgres/test/migrations/`.

Scenario (single namespace `public`):
1. **Build the contract** with one table `profile(id, owner_id int, …)`, one role `app_user`, one `policy_select` (e.g. `using = "owner_id = current_setting('app.uid')::int"`). Author it via the D4 PSL path if reachable from the adapter test; otherwise build the contract from the foundation IR directly (whichever is simpler — note which you used).
2. **Pre-create the role** in PGlite: `driver.query('CREATE ROLE app_user')` (role creation is out of scope for the planner; the harness does it).
3. **Plan** against the empty schema (mirror the cross-namespace test's `createPlanner(controlAdapter).plan({ contract, schema: emptySchema, policy: INIT_ADDITIVE_POLICY, fromContract: null, frameworkComponents, spaceId })`). Assert the plan contains `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` (sanity; AC5 already covers ordering).
4. **Apply** the plan (iterate `plan.operations`, run `[...precheck, ...execute, ...postcheck]` via `driver.query`).
5. **Prove RLS filters rows** — the spine assertion: insert two `profile` rows with different `owner_id`; `GRANT SELECT ON profile TO app_user`; `SET ROLE app_user`; `SELECT set_config('app.uid', '<owner of row 1>', false)`; `SELECT * FROM profile` → assert **only row 1** returns; `RESET ROLE`.
6. **Re-verify clean** — `introspect()` then the verify path (D7) → `schema.extensionIssues` empty (the applied policy matches the contract).

## Scope

**In:** the integration test only (+ any tiny test-harness helper). **Out:** new production code — if the test reveals a gap in D2–D7's production code, **surface it** (don't silently patch across dispatches); a small, clearly-related fix is acceptable with a note, but a real gap is a halt. SQLite/Mongo untouched.

## Completed when (AC6 + slice DoD)

- [ ] The §6-I test passes in CI (PGlite): author → plan → apply → `SET ROLE` → **only the owner's row returns** → re-verify `extensionIssues` empty.
- [ ] Gates (run once): the new test; target-postgres + adapter typecheck; `pnpm lint:deps`; **`pnpm fixtures:check` clean**; **SQLite + Mongo suites green** (AC7's remaining halves). If the unrelated `db-init-update.cli.integration.test.ts` flake (afterEach 100ms timeout) appears, re-run that file in isolation to confirm it's pre-existing, and note it — it is not part of this slice.

## Standing instruction

Tests-first is moot (this *is* the test). Drive the real production path end to end — do not stub the planner/verifier. If a row is NOT filtered (RLS not actually enforced) or `extensionIssues` is non-empty after apply, that's a real failure in the pipeline — investigate + surface which dispatch's code is implicated rather than tweaking the test to pass.

## Halt conditions (surface, do not improvise)

- RLS doesn't actually filter rows under `SET ROLE` (the policy isn't enforced) — surface with the diagnosis (which layer).
- Re-verify reports non-empty `extensionIssues` for a correctly-applied policy (a false drift — likely an introspection/recompute or namespace mismatch) — surface.
- The test needs new production code beyond a trivial related fix — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work.

## References

- **Authoritative:** slice spec §6-I. Pattern: `cross-namespace-fk.integration.test.ts`. The path under test: D4 PSL → D6 plan → apply → D7 verify; D3 introspection; D5 ops.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — one integration test mirroring an existing harness.
- **Time-box:** ~75 min. Overrun → halt and surface.
