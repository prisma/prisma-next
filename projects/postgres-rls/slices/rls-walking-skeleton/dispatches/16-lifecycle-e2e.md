# Dispatch D16 — lifecycle e2e: edit replaces, removal fails verify (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. The live PGlite proof of D14+D15 (edit-trap fix) and D13 (removal→drift). Test-only; reuse the existing walking-skeleton-psl harness. Commit your own work.

## Task

Add a lifecycle integration test under `packages/3-targets/6-adapters/postgres/test/migrations/` (mirror `rls-walking-skeleton-psl.integration.test.ts` for PGlite startup, PSL→contract via `interpretPslDocumentToSqlContract`, plan, apply; `test.execArgv = ['--no-memory-protection-keys']`). Single table `profile`, role `app_user`, prefix `p_read`.

**Scenario 1 — edit replaces (the headline; proves exactly one policy active):**
1. Author the policy with predicate **A** (e.g. `using = "owner_id = current_setting('app.uid')::int"`) → plan vs empty schema → apply. Assert the policy `p_read_<hashA>` exists in `pg_policies` for the table.
2. Re-author the SAME prefix `p_read` with a DIFFERENT predicate **B** (e.g. `using = "owner_id = current_setting('app.uid')::int AND deleted_at IS NULL"` — add a `deleted_at` column to the model so B is valid). Introspect the live DB → plan against the introspected schema → **assert the plan contains BOTH** a create for `p_read_<hashB>` and a drop for `p_read_<hashA>`. Apply.
3. **The operator-observable assertion:** query `pg_policies` for the table → **exactly one** policy row, named `p_read_<hashB>`. Confirm predicate B is in effect: insert rows, `SET ROLE app_user` + `set_config('app.uid',…)`, and assert the result reflects predicate B (e.g. a soft-deleted owned row is now excluded), not predicate A.

**Scenario 2 — removal fails verify (slice-1 behavior, not auto-drop):**
4. From the post-step-3 DB (policy `p_read_<hashB>` present), author a contract with the policy **removed** (no `policy_select` block). Introspect → run the family `verifySchema` (or the verify path used in `rls-verify-extension-issues.integration.test.ts`) → assert the result is a **failure**: `ok: false` and `extensionIssues` non-empty naming the orphaned `p_read_<hashB>`. (It is NOT auto-dropped — that's slice 2. This proves the safe loud signal.)

## Completed when

- [ ] Scenario 1 passes: edit → plan has create+drop → apply → **exactly one** policy active (`p_read_<hashB>`), filtering by predicate B.
- [ ] Scenario 2 passes: removal → verify `ok:false` + `extensionIssues` names the orphaned policy.
- [ ] Gates (run once, foreground): the new test; adapter + target-postgres typecheck; `pnpm lint:deps`; `pnpm fixtures:check` clean. (The pre-existing `it.fails` in `planner.reconciliation.integration.test.ts` are expected — ignore.)

## Halt conditions (surface)

- The edit plan does NOT contain the drop (D15 didn't fire under the real introspected schema — a prefix-match or introspection-prefix bug) — surface with the actual plan ops.
- After apply, TWO policies remain (the drop didn't execute) — surface.
- Removal verify comes back `ok:true` (D13 verdict wiring gap under this path) — surface.

## Constraints

Test-only (no production code — if you find you need a production change, that's a real finding: surface it). Explicit-staging, `tml-2868:` prefix, no amend, **no push**. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt` (PGlite is slow — heartbeat around apply/introspect).

## References

- Harness + PSL→contract wiring: `rls-walking-skeleton-psl.integration.test.ts`. Verify path: `rls-verify-extension-issues.integration.test.ts`. The replace logic under test: D15 `buildRlsDiffCalls` in `planner.ts`.

## Operational metadata

- **Model tier:** sonnet — one integration test, two scenarios, on an existing harness.
- **Time-box:** ~60 min. Overrun → commit-partial + report.
