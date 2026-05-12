# Supabase Integration — design notes

> **Status: tentative design notes, not yet a spec.** These docs capture the design intent we've developed in conversation. They are deliberately not in spec shape (no FRs, no ACs, no milestones) and they make no commitment about project scoping or sequencing. When we settle the project shape and turn this into one or more `spec.md` files, these notes are the input.

## What's here

| Doc | Topic |
|-----|-------|
| [`overview.md`](overview.md) | The end-to-end user story. What a Supabase-using Prisma Next app looks like; what the six deliverables are; how they fit together. Start here. |
| [`posture.md`](posture.md) | The `modeled / tolerated / externally-managed / drift` posture as a generic IR property. How the verifier and planner dispatch on it. |
| [`cross-contract-refs.md`](cross-contract-refs.md) | Cross-contract-space FK references. TS: unified surface — model handles from extension contracts (e.g. `supabaseContract.models.AuthUser.refs.id`) work with existing `constraints.foreignKey` / `rel.belongsTo` call sites. PSL: colon-prefixed dot-qualified type refs (`supabase:auth.User`). Implicit resolution via `extensionPacks`. Ownership rules, dependency graph, `__unspecified__` × cross-contract DDL. |
| [`rls.md`](rls.md) | RLS policies as first-class Postgres IR. `PostgresRlsPolicy` node, inline `m.constraints.rlsPolicy({...})` DSL, migration ops, verifier against `pg_policies`. |
| [`extension-package.md`](extension-package.md) | The `@prisma-next/extension-supabase` package shape. Hand-authored `contract.json`, single `supabase()` runtime facade composing Postgres internally, `asUser` / `asAnon` / `asServiceRole` role helpers, RLS session-state injection, typed role constants. |
| [`developer-experience.md`](developer-experience.md) | Scaffold (`prisma-next init --supabase` or equivalent), getting-started docs, working example app (must-have). |
| [`deferred.md`](deferred.md) | Things we've explicitly decided to defer or rule out (visibility/encapsulation, introspection-based emit, realtime, etc.). |
| [`example/`](example/) | **Design-time sketch of the runnable example app.** TypeScript written against the design as it stands today, intentionally not implementation-ready. Surfaces concrete design holes the topic-by-topic notes don't cover; see [`example/design-holes.md`](example/design-holes.md). |

## Foundation that's already settled

This work builds on the **[Target-Extensible IR project (TML-2459)](https://linear.app/prisma-company/issue/TML-2459)**. The following are already in scope of that project and assumed available; Supabase work doesn't redo them:

- Polymorphic IR (framework / family / target layering) — Contract IR and Schema IR as class hierarchies.
- `Namespace` as a first-class framework concept; `PostgresSchema` target subclass; `__unspecified__` sentinel for connection-bound binding.
- Multi-schema Postgres contract authoring DSL in both PSL and the TS builder (top-level `namespaces` list + per-model `namespace` field).
- Cross-namespace FK references **within a single contract space** (`m.constraints.ref(otherModel)` infers the namespace coordinate from the target model).
- `ContractSerializer` SPI; round-trip via `target.contractSerializer.deserializeContract(json)`.
- Externally-managed concept *is not* in TML-2459 — that work lives here.

If you're reading this without TML-2459 context, read its [spec](../target-extensible-ir/spec.md) first.

## What's deliberately not decided yet

- **Project shape.** Whether this lands as one Supabase project or splits into a foundation project (posture + cross-contract refs + extension publish polish) + a Supabase-specific project on top is unresolved. The design notes are written project-shape-agnostic so we can pick the shape after the design firms up.
- **Sequencing relative to TML-2459 milestones.** Some of this work could run in parallel with TML-2459's M5b (which lands cross-namespace-FK-within-a-space); some has to wait for it. Sequence picked when project shape is settled.
- **Cost ledger.** No PE-pass yet. Don't size this against a launch date until the design is settled.

## How to read these as a fresh contributor

1. Read [`overview.md`](overview.md) first — it carries the end-to-end story and the canonical code sample.
2. Skim [`example/`](example/) next — the example app sketch makes the design concrete in a way the topic docs don't.
3. Then read whichever component doc is closest to your task.
4. [`deferred.md`](deferred.md) is short and worth skimming so you don't propose deferred work.
5. Each doc has an "Open questions" section at the bottom; [`example/design-holes.md`](example/design-holes.md) is the canonical list of unresolved design questions discovered by exercising the example.
