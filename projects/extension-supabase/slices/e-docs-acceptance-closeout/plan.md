# Slice E — build plan (dispatch decomposition)

Spec: [`spec.md`](spec.md). **Do not start until F ([#960](https://github.com/prisma/prisma-next/pull/960)) merges.** Rebase this slice onto the post-F `main` first — F reshapes the shipped `contract.json`, which the acceptance harness verifies against.

## Authorship vs. dispatch

Narrative docs are orchestrator-authored (not delegated); code is dispatched to a sonnet-mid implementer; the acceptance execution is manual.

| # | Unit | Owner | Depends on |
|---|---|---|---|
| B0 | Reconcile codex [#913](https://github.com/prisma/prisma-next/pull/913) — fold-in-and-close or supersede | Orchestrator (coordination) | — |
| B1 | Package README rewrite | Orchestrator (author) | B0 |
| B2 | `examples/supabase/README.md` (incl. acceptance procedure) | Orchestrator (author) | B5 shape known |
| B3 | `decisions.md` ✅ marking + PR links | Orchestrator (author) | — |
| B4 | ADR-draft promotion pass (scoped; flag others) | Orchestrator (triage) | — |
| B5 | `real-supabase.acceptance.test.ts` — env-guarded four-flow harness | **Dispatch** (sonnet-mid) | rebased on F |
| B6 | Skill repoint (TML-2492) | Orchestrator — **only if OQ1 resolves to "exists/create-here"** | OQ1 |
| B7 | Delete `projects/extension-supabase/` | Orchestrator | B1–B6 merged into durable homes |

## Ordering

- **Parallel-safe:** B3, B4, B5 are independent — B5 is the one dispatch, run it first so its skip-green result is in hand while the docs are authored.
- **Sequential:** B0 → B1 (don't write the README twice); B5-shape → B2 (the example README documents the harness); everything → B7 (deletion is last, after durable content lands).
- **Single worktree caution:** if B5's dispatch runs while the orchestrator hand-edits docs in the same worktree, serialize the commits or isolate the dispatch to its own worktree — a concurrent `git restore --staged` from either side can clear the other's staging.

## Dispatch brief — B5 (the only code dispatch)

> Build `examples/supabase/test/real-supabase.acceptance.test.ts`: an env-guarded (`describe.skipIf(!process.env.DATABASE_URL || !process.env.SUPABASE_JWT_SECRET)`) real-connection variant of `rls-role-binding.integration.test.ts`. Reuse the existing four-flow bodies (asUser→owner-only; asAnon→all via public-read policy; asServiceRole→all via BYPASSRLS; expired-JWT→`InvalidJwtError`) plus the ORM update-own-with-`withCheck` flow. Connection + secret come from env instead of PGlite; sign JWTs with the real `SUPABASE_JWT_SECRET` via the existing `signJwt` helper. Seed the two `auth.users` rows over the privileged connection before the flows and tear them down after (no `bootstrapSupabaseShim`). `dbInit` migrates only the app `public.profile` + policies; verify `auth.*` and the three roles exist against the real DB. Tests-first per repo rule. Must be skipped-green when the env vars are absent — never a red on a normal CI run. Run `pnpm test:integration` (or the example's suite) to confirm skip-green, and run the full CI gate set before declaring done.

## Verification before "ready for review"

Full CI gate set (build + typecheck --force + the 13-step Lint job incl. lint:casts + fixtures:check + all three test suites) — the acceptance suite must show as *skipped*, not failed. Confirm the deleted project dir doesn't break any doc links (`pnpm lint:deps` / doc-link checks).

## Manual step (post-merge, tracked separately)

Execute B5's harness once against a provisioned real Supabase project (OQ3 — provisioning owner + secret location). Capture the run as launch-announcement evidence. This is the launch-blocking acceptance the risk register budgets a week for; it is not a code-review gate on this PR.
