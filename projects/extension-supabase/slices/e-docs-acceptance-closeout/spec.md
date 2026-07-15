# Slice E — Docs, real-Supabase acceptance, and close-out

**Linear:** TML-2503 (project ticket) · Slice-E launch ticket to be created at build-time (see Open questions)
**Gate:** Slice F ([#960](https://github.com/prisma/prisma-next/pull/960)) merged. B/C/D shipped; Slice G mechanism shipped ([#919](https://github.com/prisma/prisma-next/pull/919)); explicit-namespace-dsl feature landed ([#778](https://github.com/prisma/prisma-next/pull/778) — the example already queries via `db.sql.public.profile`). F is the only open PR gate; its merge is the sole ordering constraint.

## At a glance

This is the launch-readiness close-out for `@prisma-next/extension-supabase`. Everything the package *does* has shipped (contract, roles, RLS-through-authoring, the `db.supabase` admin root, the complete contract in F). What remains is making it launch-*ready*: accurate docs, a repointed authoring skill, a marked-up decision log, promoted ADRs, a real-Supabase acceptance run, and deletion of the transient project directory.

Six of the seven work items are codeable-and-dispatchable the moment F merges. The seventh — *executing* the acceptance run — needs a provisioned real Supabase project and is a manual step, not a code change. This slice builds the harness so that execution collapses to "set two env vars, run one suite, read the output."

## Chosen design

### 1. Package README rewrite — `packages/3-extensions/supabase/README.md`

The current README is stale: it opens "This is **M1 of the Supabase integration** — the walking-skeleton starter. Later milestones add the role-binding runtime…" — all of which shipped. Rewrite it to describe the package as-built. Required content (NFR5, plan DoD):

- **The role-binding model.** `SupabaseDb` is not a `Db`; a user picks a role first (`asUser(jwt)` / `asAnon()` / `asServiceRole()`) and only the returned `RoleBoundDb` exposes `.sql` / `.orm`. Role binding is enforced by session-coupled connections below the middleware chain (`set_config('role'/'request.jwt.claims', …, false)` + `RESET ALL` on release) — link [ADR 230](../../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md), don't restate it.
- **JWT validation modes.** `jwtSecret` (HS256 symmetric shared secret — the classic Supabase JWT secret) *xor* `jwksUrl` (asymmetric / JWKS, for Supabase projects on signing keys). Both → `SupabaseConfigError`. `asUser` is async and throws `InvalidJwtError` (typed `reason`) before any connection is acquired.
- **The `db.supabase` admin root.** Only on `asServiceRole()`; reaches `auth.*` / `storage.*` over the direct connection (service_role holds the grants). Cite decision [C15](../../../supabase-integration/decisions.md); note the "prefer GoTrue Admin API for user *management*" caveat.
- **Unsupported scope.** PostgREST/`supabase-js` interop, edge runtimes, Realtime, storage uploads — from the spec Non-goals. State plainly what the package does not do.
- **TS authoring option.** A short `.rls([...])` snippet showing the same `Profile` policies authored in TypeScript, noting that [TML-2883 (#959)](https://github.com/prisma/prisma-next/pull/959) makes the emitted wire policy names PSL-identical. This is a **doc snippet only** — the example stays PSL-authored; we do *not* maintain a parallel TS example contract (operator decision 2026-07-15). The lowering equivalence is already proven in #959's own tests, so the example need not re-prove it.
- Point at `examples/supabase` as the canonical runnable reference.

**Reconcile with the open codex draft** [#913 "docs: update Supabase runtime README"](https://github.com/prisma/prisma-next/pull/913) before writing: either fold its content in and close it, or supersede it explicitly. Do not double-author the same README in two open PRs.

### 2. Author the missing `examples/supabase/README.md`

`examples/supabase` has **no README** today, yet FR20/AC9 require one ("a README walking through setup end-to-end… reviewed for accuracy by a non-author teammate"). Write it: what the example proves, the `Profile → auth.AuthUser` cross-contract FK, the RLS policies in `contract.prisma`, how to run the hermetic (PGlite-shim) tests, and how to run the real-Supabase acceptance harness (item 6) with the two env vars.

### 3. Repoint the extension-authoring skill (TML-2492)

The plan's intent: the authoring skill names `@prisma-next/extension-supabase` as *the* canonical example of a Prisma Next extension (it now exercises pack + contract + typed handles + roles + RLS + runtime + admin root — the fullest extension in the tree). **Blocked-until-verified:** the only skill under `skills/extension-author/` is `prisma-next-extension-upgrade` (the *upgrade* skill). The "author a Prisma Next extension" skill (TML-2492) is not in the tree. At build time, resolve the fork in Open questions before dispatching this item.

### 4. Mark umbrella `decisions.md` ✅ shipped

`projects/supabase-integration/decisions.md` — annotate the decisions this integration realized as shipped, each with its merged-PR link. At minimum: C5 (roles first-class, [#957](https://github.com/prisma/prisma-next/pull/957)), C13/C14 (walking skeleton + two-lane tests), C15 (secondary `db.supabase` root, [#845](https://github.com/prisma/prisma-next/pull/845)), C16 (extension-aware infer, [#919](https://github.com/prisma/prisma-next/pull/919)), and F's complete-contract decision (C8 round-trip, [#960](https://github.com/prisma/prisma-next/pull/960)). Mechanical, one file; the value is a reader landing on the log and seeing what's real.

### 5. Promote lingering ADR drafts — **scoped to this project's own drafts**

This is a backstop: promote ADR drafts orphaned because their owning project closed *without* promoting them. **Scope discipline (stay in project):** `extension-supabase` and `supabase-integration` own no un-promoted ADR drafts of their own today — the umbrella `decisions.md` → retrospective migration is the *umbrella's* close-out (README §Close-out), not this slice's. Drafts under `projects/postgres-rls/specs/` (e.g. `adr-content-addressed-policy-names.md`) and `projects/explicit-namespace-dsl/adr-draft-always-qualified-builder-surface.md` belong to *those* projects' close-outs — flag them if still un-promoted when this slice runs, do not absorb them. Net: at build time, `grep` the Supabase-constituent project dirs for un-promoted `adr-*` drafts; promote only those with no still-open owning project; list the rest as flags. Likely a no-op with a short "nothing orphaned; X/Y belong to still-open Z" note.

### 6. Real-Supabase acceptance harness — `examples/supabase/test/real-supabase.acceptance.test.ts`

The launch-blocking acceptance run (plan DoD; risk-register "budget one week before launch"). Build it as an **env-guarded variant of the existing four-flow test**, not a bespoke script:

- Reuse the body of `rls-role-binding.integration.test.ts` verbatim where possible — it already codifies all four flows (asUser→owner-only row; asAnon→all rows via the public-read policy; asServiceRole→all rows via BYPASSRLS; expired JWT→`InvalidJwtError`), plus the ORM update-own-with-`withCheck` flow.
- **Connection from env, not PGlite.** `describe.skipIf(!process.env.DATABASE_URL || !process.env.SUPABASE_JWT_SECRET)` — the suite is a no-op (skipped, green) on every PR and in the default CI run, and *executes* only when both env vars are present. This is the C14 acceptance lane (manual / nightly), off the per-PR hot path by construction.
- **JWTs are real by construction.** Supabase/GoTrue issues HS256 JWTs signed with the project's JWT secret; the existing `signJwt(claims)` helper signs the identical shape. Signing with the real `SUPABASE_JWT_SECRET` yields a JWT the runtime validates exactly as it would a GoTrue-issued one — no GoTrue HTTP round-trip needed for the four flows. (The `jwksUrl` asymmetric path is validated separately by the package's mock-JWKS unit tests; it is not part of this acceptance run.)
- **Seed `auth.users` over the privileged connection.** The real `auth.users` exists (external); the Profile FK needs rows. Insert the two test users directly (`asServiceRole().supabase.orm.auth.AuthUser.createCount(...)` or a raw privileged insert) rather than the shim's fabricated table. Tear them down after. (Caveat noted in the README: direct `auth.*` writes are for the harness; app user-management prefers the GoTrue Admin API.)
- **Migrate the app contract, tolerate the external world.** `dbInit` applies only the app's `public.profile` + policies; the planner emits no DDL for `auth.*` (external). The verifier confirms `auth.*` shape and the three roles exist against the real DB — the F contract is what makes this pass clean.
- Output is the launch evidence: paste the run into the launch announcement.

### 7. Close-out — dir deletion **deferred to umbrella close-out**

The durable content migrates out of the project dir in items 1–6 (decision log, READMEs, harness). The dir *deletion*, however, is **deferred to the umbrella close-out**, not done in this slice — because the umbrella `projects/supabase-integration/` (which Will scoped out of this work and stays live) densely references `../extension-supabase/spec.md` / `plan.md` (the README constituent table, `overview.md` §7–8, `decisions.md` C2/C12, `example/design-holes.md`), as does `projects/native-postgres-enums`. Deleting now would leave the live umbrella with dangling links or force throwaway link-surgery across docs that are themselves deleted at umbrella close-out. The umbrella's own README §Close-out states the constituent dirs are "deleted **alongside** the `projects/supabase-integration/` directory" — so the deletion rides with that, matching the project workflow rather than fighting it.

## Coherence rationale (slice-INVEST · Small)

One reviewer holds this in a sitting: it is the close-out PR for one package. Six items are docs/config/deletion; the seventh is one test file that reuses an existing test body behind an env guard. There is no cross-cutting production-code change — the package's behavior shipped in B–F. The diff is one coherent "make it launch-ready" unit, rollback-able as one. The one code-bearing item (the harness) is the natural heaviest dispatch and may be its own commit within the PR, but it does not split the slice.

## Scope

**In:** package README rewrite; example README; skill repoint (pending Open-questions resolution); `decisions.md` ✅ marking; ADR-draft promotion scoped to this project's orphans; the env-guarded acceptance harness; deletion of `projects/extension-supabase/`.

**Deliberately out:**
- **Executing** the acceptance run against a live project — that needs provisioned infra and is a manual post-merge step; this slice ships the harness that makes it one command.
- The umbrella `decisions.md` → retrospective doc migration and `projects/supabase-integration/` deletion — that is the *umbrella's* close-out, triggered when every constituent lands, not this constituent's slice.
- Other projects' un-promoted ADR drafts (postgres-rls, explicit-namespace-dsl) — flag, don't absorb.
- The `auth.uid()`-as-column-default stretch (plan's optional item) — defer to v0.2 unless trivially in reach at build time.

## Pre-investigated edge cases

| Case | Handling |
|---|---|
| Acceptance suite would fail CI when no real DB is configured | `skipIf` on both env vars — skipped-green is the correct per-PR state; never a red. |
| `auth.users` rows absent → Profile FK insert fails on the real DB | Harness seeds the two users over the privileged connection before the flows; tears them down after. |
| README authored twice (this slice + codex #913) | Reconcile #913 first — fold-in-and-close or supersede — before writing item 1. |
| Deleting the project dir removes this spec mid-slice | Deletion is the final step, after items 1–6 migrate durable content out; the PR is the record. |

## Definition of done

Slice-specific (CI-green + reviewer-accept + project-DoD floor are inherited, not restated):

- [ ] Package README describes the as-built package (role-binding model, JWT modes, `db.supabase` root, unsupported scope); codex [#913](https://github.com/prisma/prisma-next/pull/913) reconciled (folded-in-and-closed or explicitly superseded).
- [ ] `examples/supabase/README.md` exists and is accuracy-reviewed by a non-author (AC9).
- [ ] Extension-authoring skill (TML-2492) names this package as canonical example — *or* Open-question 1 resolved to defer/create with a recorded rationale.
- [ ] `decisions.md` marks the shipped decisions ✅ with merged-PR links.
- [ ] ADR-draft promotion pass run; this project's orphans promoted; others' drafts flagged not absorbed.
- [ ] `examples/supabase/test/real-supabase.acceptance.test.ts` exists, env-guarded, reuses the four-flow bodies; skipped-green in CI; documented in the example README as the acceptance procedure.
- [x] Post-launch deferrals (perf benchmarks NFR1/2·AC12; subpath bundle thresholds NFR3·AC1 — operator-approved defer 2026-07-15) migrated to a durable home — recorded in the package README "Known gaps (deferred to post-launch)" section.
- [ ] ~~`projects/extension-supabase/` deleted~~ — **deferred to umbrella close-out** (see §7): the live umbrella densely references this dir; deletion rides with `projects/supabase-integration/` deletion per the umbrella README §Close-out.
- [ ] **Manual, post-merge (not a code-review gate):** the acceptance harness executed once against a provisioned real Supabase project, all four flows pass, evidence captured in the launch announcement.

## Open questions

1. **Does TML-2492's authoring skill exist?** The tree has only `skills/extension-author/prisma-next-extension-upgrade` (the upgrade skill). If the authoring skill exists elsewhere/later → repoint it at this package. If it does not exist yet → either (a) this slice creates a minimal authoring skill citing supabase as the canonical example, or (b) the repoint defers to TML-2492's own delivery and this slice records the dependency. **Resolve at build-time; lean (b)** unless the operator wants the skill created here — creating a skill is arguably its own slice.
2. **Slice-E launch ticket.** Create a dedicated TML issue under the extension-supabase project for this slice's tracker home, or track under TML-2503? Ticket creation is a tracker side-effect — confirm with the operator at build-time before creating.
3. **Provisioning ownership.** Who provisions the real Supabase project for the acceptance execution, and where do `DATABASE_URL` / `SUPABASE_JWT_SECRET` live (CI secret vs. local run)? Needed only for the manual execution step, not for shipping the harness.

## References

- [`plan.md`](../../plan.md) §"Slice E" — the DoD this slice realizes.
- [`spec.md`](../../spec.md) — FR20/FR21 (example app + acceptance), NFR5 (README), AC9/AC10/AC11.
- [Umbrella `decisions.md`](../../../supabase-integration/decisions.md) — C5, C8, C13, C14, C15, C16 (the shipped decisions item 4 marks).
- [Umbrella `README.md`](../../../supabase-integration/README.md) §"Close-out" — the *umbrella's* close-out (distinct from this slice's).
- [ADR 230](../../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) — the role-binding model the README links.
- `examples/supabase/test/rls-role-binding.integration.test.ts` — the four-flow test the acceptance harness reparameterizes.
- Codex [#913](https://github.com/prisma/prisma-next/pull/913) — the open README draft to reconcile.
