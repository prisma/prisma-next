# Dispatch D19 — Supabase example behavioral e2e: filtering + drift-fails-verify (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. The slice's **headline operator-observable proof** on the real CLI + real dev DB, building on D18's setup (policy now in `contract.prisma`/`contract.json`, shim provides roles + `auth.uid()`, `db init` applies it). Commit your own work.

## Task

Extend `examples/supabase/test/skeleton.integration.test.ts` (or add a sibling test in `examples/supabase/test/`) that, after `db init` applies the policy, proves the two behaviors a developer relies on:

**A — RLS actually filters rows under the role:**
1. As the table owner / default connection (bypasses RLS), insert two `profile` rows with **different `owner_id`** uuids (call them ownerA, ownerB).
2. Via a raw client (`withClient`): `SET ROLE authenticated`; `SELECT set_config('request.jwt.claims', '{"sub":"<ownerA-uuid>"}', true)` (matches the shim's `auth.uid()` = `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid`); `SELECT * FROM public.profile` → **only ownerA's row** returns; `RESET ROLE`. (RLS applies to the non-owner `authenticated` role; the owner/superuser bypasses it — so the filtering assertion MUST run under `SET ROLE authenticated`.)

**B — out-of-band drift fails `db verify` (the true CLI-exit-equivalent proof):**
3. As superuser, drop the policy out of band: `DROP POLICY "<wirename>" ON public.profile` (get the wire name from `pg_policies` or the contract — `profile_owner_read_dc40c58a`).
4. Run `client.dbVerify({...})` → assert **`verifyResult.ok === false`** and that the failure/`extensionIssues` names the dropped policy. (This is the operator-visible "drift makes verify fail" — the headline.)

## Completed when (slice-1 headline DoD)

- [ ] A: under `SET ROLE authenticated` + the jwt GUC, only the matching owner's row is visible (assert exact rows, by value).
- [ ] B: an out-of-band `DROP POLICY` makes `client.dbVerify` return `ok:false` naming the policy.
- [ ] Gates (run once, foreground): the example suite (real dev DB — heartbeat, slow); `pnpm build`; workspace `pnpm typecheck`; `pnpm lint:deps`. (`fixtures:check` pre-existing `cipherstash-encrypted-*` failure is not yours.)

## Halt conditions (surface — real findings)

- Filtering does NOT occur under `SET ROLE authenticated` (RLS not actually enforced via the CLI-applied policy) — surface with the diagnosis.
- `db verify` returns `ok:true` after the out-of-band drop (orphan/missing detection gap on the real-DB CLI path vs the adapter harness) — surface.

## Scope

**In:** the behavioral e2e (A + B) in the example app. **Out:** edit/remove lifecycle (proven at adapter level in D16); F03/F07 + anti-leak test (D20).

## Constraints

Test-only (no production change — if a step needs one, that's a finding: surface it). Explicit-staging — never stage `cipherstash-encrypted-*` or `trace.jsonl`. `tml-2868:` prefix, no amend, **no push**. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`.

## References

- The example harness + `client.dbInit`/`client.dbVerify`/`withClient`/`db.connect`: `examples/supabase/test/skeleton.integration.test.ts` (as extended by D18). The shim `auth.uid()`: `packages/3-extensions/supabase/test/supabase-bootstrap.ts`.

## Operational metadata

- **Model tier:** sonnet — one behavioral e2e on the existing example harness.
- **Time-box:** ~60 min (real dev DB is slow). Overrun → commit-partial + report.
