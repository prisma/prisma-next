# Supabase integration — umbrella project

> **Status: umbrella tracker.** This directory no longer carries a single project spec/plan. The Supabase integration is decomposed into five framework-primitive projects (four new + one already split out) plus an integration project. Each constituent has its own `spec.md` + `plan.md` and its own Linear ticket. The umbrella retains shared artefacts that don't belong to any single constituent: the canonical decisions log, the design-artifact example app, the deferred-items list, and the long-form overview.

## Decomposition

The Supabase integration is delivered through five framework-primitive projects + one integration project. All five framework primitives are independent of each other and depend on TML-2459. The integration project depends on all of them.

| Project | Concern | Status | Linear |
|---|---|---|---|
| [target-extensible-ir](../target-extensible-ir/spec.md) | Polymorphic Contract IR + Schema IR; `Namespace` framework concept; within-contract cross-namespace FKs | Shaped, implementer-ready | [TML-2459](https://linear.app/prisma-company/issue/TML-2459) |
| [control-policy](../control-policy/spec.md) | Framework primitive: `control` field + `ControlPolicy` enum (`managed`/`tolerated`/`external`/`observed`); verifier/planner dispatch tables | Shaped | [TML-2493](https://linear.app/prisma-company/issue/TML-2493) |
| [cross-contract-refs](../cross-contract-refs/spec.md) | FK references across contract-space boundaries; brand machinery; `supabase:auth.User` PSL grammar; dependency graph + namespace ownership | Shaped | [TML-2500](https://linear.app/prisma-company/issue/TML-2500) |
| [postgres-rls](../postgres-rls/spec.md) | RLS policies + Postgres roles as target-only IR; `.rls(...)` TS surface + `policy <name> { ... }` PSL surface; content-addressed wire names; verifier + planner | Shaped | [TML-2501](https://linear.app/prisma-company/issue/TML-2501) |
| [runtime-target-layer](../runtime-target-layer/spec.md) | Export `SqlRuntime`; new `PostgresRuntime extends SqlRuntime`; `withRawConnection` below-middleware accessor; transaction primitive formalisation | Shaped | [TML-2502](https://linear.app/prisma-company/issue/TML-2502) |
| [extension-supabase](../extension-supabase/spec.md) | `@prisma-next/extension-supabase` package: shipped contract, typed handles, pack descriptor, `SupabaseRuntime`, example app | Shaped | [TML-2503](https://linear.app/prisma-company/issue/TML-2503) |

### Dependency graph

```
            ┌─────────────────────────┐
            │ target-extensible-ir    │
            │ (TML-2459)              │
            └────────────┬────────────┘
                         │
            ┌────────────┴────────────┐
            │ control-policy          │
            │ (TML-2493)              │
            └────────────┬────────────┘
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌────────────────────┐
│ cross-      │  │ postgres-   │  │ runtime-target-    │
│ contract-   │  │ rls         │  │ layer              │
│ refs        │  │             │  │                    │
└──────┬──────┘  └──────┬──────┘  └─────────┬──────────┘
       │                │                   │
       └────────────────┼───────────────────┘
                        ▼
            ┌─────────────────────────┐
            │ extension-supabase      │
            │ (May 18 launch)         │
            └─────────────────────────┘
```

The three middle-tier projects (`cross-contract-refs`, `postgres-rls`, `runtime-target-layer`) can ship in any order once `target-extensible-ir` reaches M5b and `control-policy` lands. `extension-supabase` consumes all three.

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
