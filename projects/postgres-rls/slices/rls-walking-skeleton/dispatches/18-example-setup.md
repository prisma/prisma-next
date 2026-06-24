# Dispatch D18 — Supabase example: shim roles + PSL policy + emit (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. The example-app **setup + migrate + verify-clean** half (the behavioral filtering/drift e2e is D19). This also exercises the **production CLI emit path** (`prisma-next contract emit`) for `policy_select` — a real test of whether the CLI lowers a policy into `contract.json` (a D9-style gap would surface here). Commit your own work.

## Task

1. **Shim roles + `auth.uid()`** — `packages/3-extensions/supabase/test/supabase-bootstrap.ts` (its doc comment already names this as the postgres-rls constituent's job; `examples/supabase/test/supabase-bootstrap.ts` re-exports it). Add, idempotently (`IF NOT EXISTS` / `DO $$` guards — PGlite + real PG):
   - `CREATE ROLE anon NOLOGIN`, `authenticated NOLOGIN`, `service_role NOLOGIN` (match Supabase; roles are platform-provided in real Supabase — the shim emulates that).
   - A `auth.uid()` function returning the current request's user id from a **settable GUC**, faithful to Supabase: `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid` (returns NULL when unset). Update the shim's doc comment (the "Future increments" note) to reflect that roles + `auth.uid()` now exist.
2. **Author the policy in the example** — `examples/supabase/src/contract.prisma`. Add an owner column to `Profile` (`owner_id String` — a uuid-typed owner) and a `policy_select` block, e.g.:
   ```
   policy_select profile_owner_read {
     target = Profile
     roles  = [authenticated]
     using  = "owner_id = auth.uid()"
   }
   ```
   (Match the actual `policy_select` descriptor syntax from `postgres/src/core/authoring.ts` + `psl-policy-authoring.test.ts`.)
3. **Re-emit the contract artifacts** — run the example's emit (`pnpm --filter <example pkg> emit`, i.e. `prisma-next contract emit`) to regenerate `examples/supabase/src/contract.json` + `contract.d.ts`. **Verify `contract.json` actually contains the lowered `rlsPolicy` entry** with the content-addressed wire name — if `prisma-next contract emit` does NOT emit the policy (the CLI emit path doesn't run the generic lowering D10 wired into `interpretPslDocumentToSqlContract`), that is a **production finding — HALT and surface it** (do not hand-edit contract.json).
4. **Update the skeleton test** — `examples/supabase/test/skeleton.integration.test.ts`: `db init` now also enables RLS + creates the policy on `public.profile`; assert the apply emits those ops, and `db verify` still passes (`verifyResult.ok === true`). Add `owner_id` to the profile insert/round-trip so existing steps still pass.

## Completed when

- [ ] Shim creates the three roles + `auth.uid()`; doc comment updated.
- [ ] `contract.prisma` has the policy; `pnpm emit` regenerates `contract.json`/`contract.d.ts` **with the rlsPolicy present** (committed).
- [ ] Skeleton test green: `db init` applies ENABLE RLS + CREATE POLICY for public.profile; `db verify` passes.
- [ ] Gates (run once): the example's test suite; `pnpm build`; workspace `pnpm typecheck`; `pnpm lint:deps`; `pnpm fixtures:check` (the example's committed contract artifacts are fixtures — they must be regenerated, not stale; the pre-existing `cipherstash-encrypted-*` untracked dirs are NOT yours).

## Halt conditions (surface — real findings)

- `prisma-next contract emit` does not lower `policy_select` into `contract.json` (CLI emit path gap) — HALT, surface with what the emit produced.
- `db verify` fails after `db init` applies the policy (the example's real-DB introspection/verify disagrees with the adapter-test harness) — surface with the failure.

## Scope

**In:** shim, example PSL + re-emit, skeleton test create+verify-clean. **Out:** the runtime filtering + out-of-band-drop→verify-fails e2e (D19); edit/remove (proven at adapter level in D16).

## Constraints

Explicit-staging (do NOT stage `cipherstash-encrypted-*` or `trace.jsonl`), `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt` (real-DB test is slow). Low budget → commit what compiles + report.

## Return shape

The shim additions (roles + the `auth.uid()` body); the policy block; **whether `prisma-next contract emit` emitted the rlsPolicy into contract.json** (the key checkpoint); the skeleton-test assertions; gate results; commit SHA; anything surprising. Begin.