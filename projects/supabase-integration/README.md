# Supabase integration — umbrella project

> **Status: umbrella tracker.** This directory no longer carries a single project spec/plan. The Supabase integration is decomposed into six framework-primitive projects plus an integration project. Each constituent has its own `spec.md` + `plan.md` and its own Linear ticket. The umbrella retains shared artefacts that don't belong to any single constituent: the canonical decisions log, the design-artifact example app, the deferred-items list, and the long-form overview.

## Decomposition

The Supabase integration is delivered through six framework-primitive projects + one integration project. The framework primitives are independent of each other; all depend on the target-extensible IR foundation (TML-2459) — `explicit-namespace-dsl` specifically on its runtime-qualification slice (TML-2605). The integration project depends on all of them.

Status reflects the state as of the last planning pass (2026-06-04); keep it current as constituents land.

| Project | Concern | Status | Linear |
|---|---|---|---|
| target-extensible-ir-namespaces | Polymorphic Contract IR + Schema IR; `Namespace` framework concept; within-contract cross-namespace FKs | ✅ **Done & closed** (incl. runtime-qualification TML-2605; project dir removed) | [TML-2459](https://linear.app/prisma-company/issue/TML-2459) |
| [control-policy](../control-policy/spec.md) | Framework primitive: `control` field + `ControlPolicy` enum (`managed`/`tolerated`/`external`/`observed`); verifier/planner dispatch tables | ✅ **Effectively done** — slices 1–5 shipped; slice 6 (`@@control` PSL) in flight | [TML-2493](https://linear.app/prisma-company/issue/TML-2493) |
| [cross-contract-refs](../cross-contract-refs/spec.md) | FK references across contract-space boundaries; brand machinery; `supabase:auth.User` PSL grammar; dependency graph + namespace ownership | 🔜 **Next up** (lane 2) — fully unblocked | [TML-2500](https://linear.app/prisma-company/issue/TML-2500) |
| [postgres-rls](../postgres-rls/spec.md) | RLS policies + Postgres roles as target-only IR; `.rls(...)` TS surface + `policy <name> { ... }` PSL surface; content-addressed wire names; verifier + planner | Shaped — follows cross-contract-refs; PSL side gated on TML-2537 | [TML-2501](https://linear.app/prisma-company/issue/TML-2501) |
| [runtime-target-layer](../runtime-target-layer/spec.md) | Export `SqlRuntime`; new `PostgresRuntime extends SqlRuntime`; `withRawConnection` below-middleware accessor; transaction primitive formalisation | Shaped — short interleave (~50–100 LOC core), independent | [TML-2502](https://linear.app/prisma-company/issue/TML-2502) |
| [explicit-namespace-dsl](../explicit-namespace-dsl/spec.md) | Namespace-aware DSL/ORM query surface (`db.sql.<ns>.<table>`, `db.<ns>.<Model>`); disambiguates colliding cross-namespace names (`auth.users` vs `public.users`); additive on the default-namespace fallback | 🚧 **In progress (Serhii)** — **launch blocker** | [TML-2550](https://linear.app/prisma-company/issue/TML-2550) |
| [extension-supabase](../extension-supabase/spec.md) | `@prisma-next/extension-supabase` package: shipped contract, typed handles, pack descriptor, `SupabaseRuntime`, example app | 🔜 **M1 + skeleton starting** (lane 1) | [TML-2503](https://linear.app/prisma-company/issue/TML-2503) |

The PSL-block substrate [target-contributed-psl-blocks](../target-contributed-psl-blocks/spec.md) (TML-2537, in flight) is not a constituent but is on the critical path: it gates `postgres-rls`'s PSL `policy {}` surface (PSL authoring is must-have for launch).

### Dependency graph

```
                        ┌─────────────────────────┐
                        │ target-extensible-ir    │
                        │ (TML-2459)              │
                        └────────────┬────────────┘
                                     │
                  ┌──────────────────┴──────────────────┐
                  ▼                                      ▼
          ┌───────────────┐               ┌──────────────────────────┐
          │ control-policy│               │ explicit-namespace-dsl   │
          │ (TML-2493)    │               │ (TML-2550) — needs the   │
          └───────┬───────┘               │ runtime-qualification    │
                  │                        │ slice (TML-2605)         │
       ┌──────────┼──────────┐            └─────────────┬────────────┘
       ▼          ▼          ▼                          │
┌────────────┐┌─────────┐┌────────────────┐            │
│ cross-     ││postgres-││ runtime-target-│            │
│ contract-  ││ rls     ││ layer          │            │
│ refs       ││         ││                │            │
└──────┬─────┘└────┬────┘└────────┬───────┘            │
       │           │             │                     │
       └───────────┴─────────────┴──────────┬──────────┘
                                             ▼
                                ┌─────────────────────────┐
                                │ extension-supabase      │
                                │ (integration / launch)  │
                                └─────────────────────────┘
```

The three control-policy-dependent middle-tier projects (`cross-contract-refs`, `postgres-rls`, `runtime-target-layer`) can ship in any order once `target-extensible-ir` reaches M5b and `control-policy` lands. `explicit-namespace-dsl` runs on a parallel track: it depends only on the runtime-qualification slice (TML-2605) of `target-extensible-ir`, not on `control-policy`, so it can be built alongside them. `extension-supabase` consumes all four — and it **cannot ship without `explicit-namespace-dsl`**, because a Supabase app addresses tables in `auth.*` and `public.*` that collide by bare name (both schemas have a `users` table); without the namespace-aware query surface there is no way to reach `auth.users`, and everything collapses into a single namespace. That is the user-facing fudge the integration must not ship.

## Walking skeleton — the incremental example

The integration is delivered against a **walking skeleton**: a single *runnable* example app, stood up early and grown one feature at a time, that serves as the continuous integration surface across all the independent lanes. Rather than building the canonical example as a big-bang at the end of `extension-supabase`, we stand it up at the start and make "wire your feature into the running example" a **definition-of-done clause on every constituent**. A seam mismatch between two projects then surfaces the day it's introduced, not at integration time.

- **Location:** `examples/supabase` (top-level, alongside the other example apps — *not* under the package). The package itself stays at `packages/3-extensions/supabase/`.
- **Stood up by:** `extension-supabase` **M1**, which only needs the already-landed foundation + `control-policy`. M1 ships `/pack` + `/contract` (hand-authored Supabase contract + typed handles); the skeleton runs on the stock `@prisma-next/postgres/runtime` factory. The Supabase `/runtime` subpath (`SupabaseRuntime`, `asUser`/`asAnon`/`asServiceRole`) is deferred to M2 — the skeleton does not need it to be runnable.
- **Grows as each constituent lands:**

  | Constituent lands | The running example gains |
  |---|---|
  | `extension-supabase` M1 | Loads the Supabase contract; `Profile` in `public`; basic query against `public.*` on the stock Postgres runtime. |
  | `runtime-target-layer` | `/runtime` runs on a real `PostgresRuntime` (then `SupabaseRuntime` at M2). |
  | `cross-contract-refs` | `Profile.userId → auth.User.id` FK with cascade; planner emits qualified `REFERENCES "auth"."users"`. |
  | `postgres-rls` | `.rls([…])` / `policy {}` policies on `Profile`; verifier diffs `pg_policies`. Enforcement proven via manual `SET ROLE` until the runtime lands. |
  | `explicit-namespace-dsl` | Query reaches `auth.users` explicitly alongside `public.users`. |
  | `extension-supabase` M2/M3 | `asUser`/`asAnon`/`asServiceRole` role binding; the live-query RLS e2e (anon denied / user sees own rows / service_role bypasses) lights up. |

  Each constituent's plan carries the matching one-line DoD: *"the `examples/supabase` app exercises this feature."*

### How it's tested

Two lanes, deliberately split:

- **Hermetic (every-PR CI): PGlite + a hand-authored Supabase shim.** PGlite is real Postgres in WASM, so roles, `SET ROLE`, RLS, and `current_setting('request.jwt.claims')` all work in-process with no Docker. A `bootstrapSupabaseShim(client)` helper (mirroring [`test/integration/test/postgres-bootstrap.ts`](../../test/integration/test/postgres-bootstrap.ts)) seeds the roles (`anon`/`authenticated`/`service_role`/`authenticator`), the `auth` schema + `auth.users`, and `auth.uid()`/`auth.jwt()`/`auth.role()` as SQL functions reading the session GUCs — exactly how real Supabase implements them. This lane covers the FK, RLS enforcement (manual `SET ROLE` for policy correctness), the verifier, and namespace queries.
- **Acceptance (manual / nightly, not per-PR): real Supabase.** Either the Supabase CLI via the `supabase/setup-cli` GitHub Action + `supabase start` (full Docker stack) or a real cloud project behind secrets. This is the ground truth for GoTrue-issued JWTs and the [C8](decisions.md) round-trip property (introspect → emit → re-introspect → diff empty). Docker stays off the hot path; it only runs here.

This separation also answers "how do we test RLS before the runtime exists": **policy correctness** (does an emitted `CREATE POLICY` filter rows when a role is active?) is tested now by setting the role by hand; **automatic role binding** (does `asUser(jwt)` bind the role below middleware?) is what the runtime project + M2 add, and its live-query e2e arrives with them. See [`decisions.md` C13/C14](decisions.md).

## Running order (current sequencing)

The foundation + `control-policy` are done, so the remaining work is highly parallel. Capacity: Will runs ~2 concurrent lanes alongside [target-contributed-psl-blocks](../target-contributed-psl-blocks/spec.md) (TML-2537) in flight; Serhii owns `explicit-namespace-dsl`.

1. **Lane 1 — `extension-supabase` M1 + walking skeleton.** Stands up `examples/supabase` on the stock Postgres runtime and authors `bootstrapSupabaseShim`. Unblocked by the done foundation + control-policy alone.
2. **Lane 2 — `cross-contract-refs`.** Chosen *before* `postgres-rls` despite RLS being the longer/riskier pole: within a single serial lane, order doesn't change total wall-clock, and cross-contract-refs is **fully unblocked end-to-end** whereas RLS's must-have PSL surface is gated on TML-2537 (step 3). Doing cross-contract-refs first lets TML-2537 finish in parallel, so `postgres-rls` can then run TS + PSL in one clean pass instead of stalling mid-project. It also lands the contract-aggregate/brand machinery the rest leans on, and delivers the headline `Profile → auth.User` FK early — validating the skeleton with something real before wading into the riskier RLS work.
3. **In flight (Will) — [`target-contributed-psl-blocks`](../target-contributed-psl-blocks/spec.md) (TML-2537).** Not a constituent but on the critical path: it's the PSL-block extensibility substrate that lets the Postgres pack contribute the `policy {}` keyword, so it **gates `postgres-rls`'s PSL surface** (PSL authoring is must-have for launch). Landing it is the pivot that lets step 4 run as a single TS + PSL lane rather than stalling.
4. **Then — `postgres-rls`** (TS + PSL in one pass) the moment TML-2537 (step 3) lands / a lane frees. **`runtime-target-layer`** is a cheap interleave (~50–100 LOC core) slotted whenever convenient; it's the substrate `SupabaseRuntime` extends in `extension-supabase` M2.
5. **In parallel throughout — `explicit-namespace-dsl` (Serhii).** The launch blocker; depends only on the landed TML-2605.
6. **Integration — `extension-supabase` M2→M4.** Role binding (`asUser`/`asAnon`/`asServiceRole`), the live-query RLS e2e, real-Supabase acceptance, close-out.

"Longest pole first" is the right call for *parallel* lanes, so `postgres-rls` should move onto its own lane as early as one frees — which coincides with TML-2537 (step 3) landing.

## What's in the umbrella directory

| File | Purpose |
|---|---|
| [`decisions.md`](decisions.md) | **Canonical decision log.** A1–A8, B1–B6, C1–C12 + offcuts OC1–OC4. The single source of truth that constituent specs cite. |
| [`overview.md`](overview.md) | End-to-end user story — what a Supabase-using Prisma Next app looks like across all the constituent projects. Read this for the integration narrative. |
| [`deferred.md`](deferred.md) | Items explicitly deferred from v0.1 (visibility/encapsulation, introspection-based emit, realtime, etc.). Umbrella-level — items deferred from a specific constituent live in that constituent's spec under Non-goals. |
| [`developer-experience.md`](developer-experience.md) | Roadmap material on the DX surface beyond v0.1 — the `prisma-next init --supabase` scaffold, getting-started docs, migration patterns. Not in any constituent's v0.1 scope; tracked here until the next shaping pass. |
| [`example/`](example/) | **Design artefact.** TypeScript written against the design as it stood during shaping. Surfaces concrete design holes; informed every constituent project. The `extension-supabase` project ships a related-but-distinct *working* example app in its own M3. |

## What's been retired

Three component docs were migrated into the constituent project specs and removed from the umbrella:

- `cross-contract-refs.md` → [`cross-contract-refs/spec.md`](../cross-contract-refs/spec.md).
- `rls.md` → [`postgres-rls/spec.md`](../postgres-rls/spec.md).
- `extension-package.md` → [`extension-supabase/spec.md`](../extension-supabase/spec.md).

Two ADR drafts were migrated alongside:

- `specs/adr-content-addressed-policy-names.md` → [`postgres-rls/specs/`](../postgres-rls/specs/adr-content-addressed-policy-names.md).
- `specs/adr-runtime-target-layer.md` → [`runtime-target-layer/specs/`](../runtime-target-layer/specs/adr-runtime-target-layer.md).

The `decisions.md` log retains the canonical record of all decisions reached during umbrella shaping; constituent specs cite it rather than re-stating its content.

## How to read this as a fresh contributor

1. Read [`decisions.md`](decisions.md) first — at-a-glance state of what's settled across the whole integration.
2. Read [`overview.md`](overview.md) for the end-to-end narrative — how the constituent projects compose into a Supabase-using Prisma Next app.
3. Skim [`example/`](example/) — the design-artifact example app. It's intentionally not implementation-ready; it informed the design surface.
4. Identify which constituent project is closest to your work. Read its `spec.md`. The spec is self-contained except for references back to `decisions.md` and to sibling specs.
5. Read the corresponding `plan.md` for the milestone structure.
6. [`deferred.md`](deferred.md) is short — worth skimming so you don't propose deferred work.

## Close-out

When all constituent projects land:

- The umbrella `decisions.md` is promoted into a Supabase-integration retrospective doc under `docs/architecture docs/` (or its content is folded into the relevant ADRs / subsystem docs that came out of the constituent close-outs, whichever the team prefers).
- The umbrella `overview.md` may migrate into a `docs/` reference doc on multi-extension architecture, depending on how durable the integration narrative turns out to be.
- The `example/` design artefact is deleted; the *working* example app shipped by the `extension-supabase` project becomes the canonical reference.
- This `projects/supabase-integration/` directory is deleted alongside the constituent project directories per the project workflow rule.
