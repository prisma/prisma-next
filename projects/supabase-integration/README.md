# Supabase Integration — design notes

> **Status: tentative design notes, not yet a spec.** These docs capture the design intent we've developed in conversation. They are deliberately not in spec shape (no FRs, no ACs, no milestones) and they make no commitment about project scoping or sequencing. When we settle the project shape and turn this into one or more `spec.md` files, these notes are the input.
>
> **For the canonical at-a-glance record of what's settled, see [`decisions.md`](decisions.md).** Component docs below carry the longer-form design narrative for each topic.

## What's here

| Doc | Topic |
|-----|-------|
| [`decisions.md`](decisions.md) | **The settled-decisions log.** Read this first if you want the at-a-glance state without the narrative. Component docs are kept consistent with it. |
| [`overview.md`](overview.md) | The end-to-end user story. What a Supabase-using Prisma Next app looks like; what the six deliverables are; how they fit together. Read this second after `decisions.md`. |
| [Control Policy project](../control-policy/spec.md) | **Moved out.** The `managed / tolerated / external / observed` control policy is a framework primitive, not Supabase-specific. Supabase consumes it by shipping `defaultControl: 'external'` for its contract. |
| [`cross-contract-refs.md`](cross-contract-refs.md) | Cross-contract-space FK references. TS: unified surface — model handles from extension contracts (e.g. `supabaseContract.models.AuthUser.refs.id`) work with existing `constraints.foreignKey` / `rel.belongsTo` call sites. PSL: colon-prefixed dot-qualified type refs (`supabase:auth.User`). Implicit resolution via `extensionPacks`. Ownership rules, dependency graph, `__unspecified__` × cross-contract DDL. |
| [`rls.md`](rls.md) | RLS policies as first-class Postgres IR. TS: `.rls([...])` staged-builder method, array of named descriptors. PSL: top-level `policy <name> { ... }` named-block declarations. Migration ops via `OpFactoryCall`; verifier against `pg_policies`. |
| [`extension-package.md`](extension-package.md) | The `@prisma-next/extension-supabase` package shape. Hand-authored `contract.json`, single `supabase()` runtime facade composing Postgres internally, `asUser` / `asAnon` / `asServiceRole` role helpers, RLS session-state injection, typed role constants. Use `supabase.pack()` (extension pack ref) and `supabase.contract<C>(json)` (typed contract handle); no `supabase()` shorthand on the contract side. |
| [`developer-experience.md`](developer-experience.md) | Scaffold (`prisma-next init --supabase` or equivalent), getting-started docs, working example app (must-have). |
| [`deferred.md`](deferred.md) | Things we've explicitly decided to defer or rule out (visibility/encapsulation, introspection-based emit, realtime, etc.). |
| [`example/`](example/) | **Design-time sketch of the runnable example app.** TypeScript written against the design as it stands today, intentionally not implementation-ready. Surfaces concrete design holes the topic-by-topic notes don't cover; see [`example/design-holes.md`](example/design-holes.md). |

> **Note on doc staleness during shaping.** Decisions land in [`decisions.md`](decisions.md) first; component docs are then refreshed to match. If a component doc contradicts `decisions.md`, the decisions log is canonical and the component doc is stale — please open an update.

## Foundation that's already settled

This work builds on the **[Target-Extensible IR project (TML-2459)](https://linear.app/prisma-company/issue/TML-2459)**. The following are already in scope of that project and assumed available; Supabase work doesn't redo them:

- Polymorphic IR (framework / family / target layering) — Contract IR and Schema IR as class hierarchies.
- `Namespace` as a first-class framework concept; `PostgresSchema` target subclass; `__unspecified__` sentinel for connection-bound binding.
- Multi-schema Postgres contract authoring DSL in both PSL and the TS builder (top-level `namespaces` list + per-model `namespace` field).
- Cross-namespace FK references **within a single contract space** (`m.constraints.ref(otherModel)` infers the namespace coordinate from the target model).
- `ContractSerializer` SPI; round-trip via `target.contractSerializer.deserializeContract(json)`.

The **[Control Policy project](../control-policy/spec.md)** lands the framework-level `control` field + `ControlPolicy` enum (`managed / tolerated / external / observed`) and the verifier/planner dispatch tables. Supabase consumes that primitive — it does not introduce it.

If you're reading this without TML-2459 context, read its [spec](../target-extensible-ir/spec.md) first.

## What's deliberately not decided yet

- **Project shape.** Whether this lands as one Supabase project or splits into a foundation project (cross-contract refs + extension publish polish) + a Supabase-specific project on top is unresolved. Control policy has already been split out into its own project ([`projects/control-policy/`](../control-policy/)). The design notes are written project-shape-agnostic so we can pick the shape after the design firms up.
- **Sequencing relative to TML-2459 milestones.** Some of this work could run in parallel with TML-2459's M5b (which lands cross-namespace-FK-within-a-space); some has to wait for it. Sequence picked when project shape is settled.
- **Cost ledger.** No PE-pass yet. Don't size this against a launch date until the design is settled.

## How to read these as a fresh contributor

1. Read [`decisions.md`](decisions.md) first — at-a-glance state of what's settled.
2. Read [`overview.md`](overview.md) for the end-to-end story and canonical code sample.
3. Skim [`example/`](example/) — the example app sketch makes the design concrete in a way the topic docs don't.
4. Then read whichever component doc is closest to your task.
5. [`deferred.md`](deferred.md) is short and worth skimming so you don't propose deferred work.
6. Each doc has an "Open questions" section at the bottom; [`example/design-holes.md`](example/design-holes.md) is the canonical list of unresolved design questions discovered by exercising the example.
