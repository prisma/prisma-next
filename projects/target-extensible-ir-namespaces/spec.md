# Summary

Deliver target-extensible IR + first-class namespaces — the substrate the downstream Supabase integration depends on. Three units of work: one sub-project (contract IR reshape proven by Postgres enum migration), one slice (runtime SQL qualification + default-namespace DSL/ORM fallback), and one additive slice (explicit namespace-aware DSL/ORM surface).

# Purpose

Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The IR gains a pack-contributed entity-kind mechanism (proven by Postgres enum migrating off the framework-shared `types` slot); runtime SQL and the DSL/ORM qualify identifiers through a default-namespace fallback so existing single-namespace consumers experience zero query-API breakage; the explicit namespace-aware surface (`db.sql.auth.user`) lands later as purely additive work.

# At a glance

This is the umbrella for the work that started as PR #534 (TML-2520 namespace exemplar, merged) and continues with two structural follow-ons and one additive ergonomic follow-on. The composition:

```text
┌──────────────────────────────────────────────────────────────────┐
│ PR #534 — namespace exemplar + cross-namespace FKs   ✓ MERGED   │
│  (storage IR is per-namespace; cross-namespace FKs ship)        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ S1 — contract-ir-planes (sub-project, TML-2584)        CLOSED   │
│  Contract IR two-plane reshape + pack-contributed entity-kind   │
│  mechanism + Postgres enum migration as exemplar                │
│  5 merged slices                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ S2 — runtime-qualification (slice, TML-2605)           → NEXT   │
│  Runtime SQL emits namespace-qualified identifiers; DSL/ORM     │
│  reads through per-family default-namespace fallback so legacy  │
│  query code keeps working unchanged                             │
│  ~1 PR                                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ S3 — explicit-namespace-dsl (slice, TML-2550)        additive   │
│  Explicit namespace-aware DSL/ORM surface (db.sql.auth.user,    │
│  db.auth.User). Purely additive on S2's default-namespace      │
│  fallback — non-default-namespace consumers opt in              │
│  ~1 PR                                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Downstream: Supabase integration initiative consumes
       this substrate. Out of this umbrella's scope.
```

Existing consumers on a single-default-namespace contract write zero query-code changes across S1+S2. Multi-namespace contracts that want explicit per-namespace navigation opt in to S3 when it lands.

# Scope

## In scope

- **S1 — contract IR two-plane reshape + pack-contributed entity-kind mechanism + Postgres enum migration as exemplar.** Sub-project (closed; delivered across five merged slices). Durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md). Tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584).
- **S2 — runtime SQL qualification + default-namespace DSL/ORM fallback.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate (Postgres: `"public"."user"`; SQLite: unqualified `"user"`; Mongo: collection key in correct namespace). DSL/ORM continues to expose flat-by-name surface (`db.sql.<table>`, `db.<Model>`); every lookup resolves through a per-family default namespace (`'public'` for Postgres; `'__unbound__'` for Mongo/SQLite) hardcoded in the family façade function. Single PR. Tracking ticket [TML-2605](https://linear.app/prisma-company/issue/TML-2605).
- **S3 — explicit namespace-aware DSL/ORM surface.** Adds `db.sql.<ns>.<table>` and `db.<ns>.<Model>` for explicit multi-namespace navigation. Purely additive on S2 — default-namespace lookups keep working unchanged. Single PR. Tracking ticket [TML-2550](https://linear.app/prisma-company/issue/TML-2550).

## Non-goals

- **First-class Postgres enum user affordances.** Typed `Role.member` references, `db.enums.X` runtime surface, codec value-narrowing, `@default(EnumName.value)` PSL lowering. Owned by the separate `postgres-enum-finishing` project; consumes this umbrella's substrate.
- **Pack-contributed PSL block grammar** (`policy {…}`, `role {…}`, etc.). Owned by [TML-2537](https://linear.app/prisma-company/issue/TML-2537) (target-contributed top-level PSL blocks). Independent project. The Postgres pack reuses the framework's existing `enum {…}` block syntax for its enum migration in S1 — pack-contributed grammar is a separate substrate.
- **PostgresRLS** (policies, roles, grants, row-level security DDL). Independent project; depends on TML-2537 substrate. The Supabase initiative's marquee feature, but not this umbrella's deliverable.
- **The `@prisma-next/supabase` extension pack.** Lives in the downstream Supabase integration initiative; consumes this umbrella's substrate.
- **Auth roles, JWT, RBAC modelling.** Downstream Supabase initiative.
- **Mongo enum support.** Mongo lacks the native type; emulating via application-side validation is out of scope here.
- **SQLite native enums** via CHECK-constraint emulation. Future axis; if added, follows the same pack-contributed entity-kind pattern S1 establishes.
- **Cross-target portability of Postgres-only features.** Postgres-pack-contributed entity kinds are Postgres-only by design; cross-target portability is not a goal.
- **`projects/` folder cleanup** of older rolled-up project folders (`target-extensible-ir/`, `namespace-exemplar/`). Cleanup happens at this umbrella's close-out per drive's `projects/` transient-folder discipline.

# Approach

Three units of work, sequenced as a stack:

**S1 establishes the IR-shape substrate** that every other unit depends on. The two-plane reshape (`contract.{domain, storage}.<ns>.<entityKind>.<entityName>`) plus the pack-contributed entity-kind mechanism are what makes the rest of the umbrella ship. Postgres enum migrating off the framework-shared `types` slot is the proof the mechanism works — without an exemplar, the descriptor surface ships untested. S1's durable decisions live in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md); it was delivered across five merged slices.

**S2 makes the namespace IR actually useful for runtime queries.** PR #534 shipped namespace-aware storage IR but the runtime kept emitting unqualified identifiers, and the DSL/ORM kept reading from a flat-by-name surface. S2 closes the loop on both: runtime SQL qualifies identifiers (no more `SELECT * FROM user` when the table is `auth.user`); DSL/ORM reads through a per-family default-namespace fallback (`db.sql.user` resolves to `'public'.user` for Postgres, `'__unbound__'.user` for Mongo/SQLite). The fallback is the **load-bearing backward-compatibility mechanism**: existing single-default-namespace consumers experience no query-API breakage from this umbrella's work.

**S3 adds the explicit namespace-aware DSL/ORM surface.** `db.sql.auth.user`, `db.auth.User`. Purely additive on S2 — default-namespace lookups keep working — so it can land independently without breaking anyone. Multi-namespace consumers opt in to explicit navigation when they need it.

The composition's two load-bearing properties:

1. **The shipping scope (S1 + S2) introduces zero user-facing query-API breakage.** Existing consumers on default-namespace contracts write the same query code they wrote before this umbrella.
2. **S1's substrate makes future pack-contributed entity kinds cheap.** RLS policies, roles, sequences, materialised views — every Postgres-only feature future work needs to ship is one descriptor registration through `AuthoringContributions.entityTypes` plus a slot key. The Supabase integration's downstream work pays only the per-feature cost, not the per-feature substrate cost.

# Project Definition of Done

- [ ] **PDoD1.** All three units (S1, S2, S3) delivered, or the additive unit (S3) explicitly deferred to a sibling initiative with the deferral recorded in `projects/target-extensible-ir-namespaces/deferred.md`.
- [ ] **PDoD2.** A multi-namespace Postgres contract is authorable (PSL + TS DSL), emittable, queryable end-to-end. Verified by an integration test that exercises a two-namespace contract through PSL authoring → contract emission → runtime DSL query → SQL execution against PGlite. (Lives in the S1 plan as one of its acceptance checks, plus a smoke test in S2.)
- [ ] **PDoD3.** The pack-contributed entity-kind substrate is exercised end-to-end. Postgres enum migrates from the framework-shared `storage.<ns>.types` slot to a Postgres-pack-contributed `storage.<ns>.postgresEnums` slot. No hardcoded `'postgres-enum'` paths or codec-hook hacks remain in `packages/1-framework/**` or `packages/2-sql/9-family/**` (audit gate: grep returns hits only in Postgres-target / Postgres-adapter packages + test fixtures). Inherits from S1's PDoD3.
- [ ] **PDoD4.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. The demo's emitted SQL contains `"public"."user"` (Postgres) / `"user"` (SQLite no-op) / `auth.users` (Mongo collection key) consistently. Inherits from S2's acceptance.
- [ ] **PDoD5.** Existing consumers on single-default-namespace contracts experience zero query-API breakage caused by this umbrella's work. Verified by: (a) demo apps' query code under `examples/prisma-next-demo/src/queries/` compiles and runs unchanged across S1+S2 landings, and (b) a regression test demonstrates `db.sql.user` resolves to the default namespace's `user` table with no explicit namespace argument.
- [ ] **PDoD6.** Long-lived ADRs migrated to `docs/architecture docs/adrs/`:
  - ADR 0001 (contract IR planes + entity-coordinate + pack-contributed entity-kind mechanism) from S1
  - Any ADR S2 produces about the default-namespace family-façade convention (if the discussion during execution surfaces enough design to warrant one)
  - Any ADR S3 produces about the namespace-aware DSL/ORM surface shape (if warranted)
- [ ] **PDoD7.** Linear Project "Target-Extensible IR + Namespaces" marked Completed (auto via GitHub PR-merge integration when the close-out PR lands referencing the appropriate Linear identifiers).
- [ ] **PDoD8.** Rolled-up project folders (`projects/target-extensible-ir/`, `projects/namespace-exemplar/`) archived or deleted with their long-lived contents migrated to `docs/` per drive's `projects/` transient-folder discipline. The umbrella's own `projects/target-extensible-ir-namespaces/` folder also deleted at close-out.
- [ ] **PDoD9.** Repo-wide references to `projects/target-extensible-ir-namespaces/**` and rolled-up sibling folders removed / replaced with `docs/` links.

# Functional Requirements

- **FR1.** Pack-contributed entity-kind mechanism exists at the framework level. Target packs register new entity kinds (storage-slot key, IR-class factory, serializer hydration, validator schema) through `AuthoringContributions.entityTypes`. Delivered by S1.
- **FR2.** Contract IR follows the canonical shape `contract.{domain, storage}.<ns>.<entityKind>.<entityName>` everywhere. Cross-references use object pairs. Entity coordinate `(namespaceId, entityKind, entityName)` is the canonical addressing primitive. Delivered by S1.
- **FR3.** Postgres enum migrates to a Postgres-pack-contributed entity slot; framework-shared `storage.<ns>.types` slot deleted as a load-bearing surface. Delivered by S1 (acts as the substrate's exemplar).
- **FR4.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. Delivered by S2.
- **FR5.** DSL/ORM exposes the existing flat-by-name surface (`db.sql.<table>`, `db.<Model>`), with every lookup resolving through a per-family default namespace (`'public'` for Postgres; `'__unbound__'` for Mongo/SQLite) hardcoded in the family façade function. Delivered by S2.
- **FR6.** Explicit namespace-aware DSL/ORM surface (`db.sql.<ns>.<table>`, `db.<ns>.<Model>`) ships as purely additive on FR5. Delivered by S3.

# Non-Functional Requirements

- **NFR1.** No regression in `pnpm test:packages` or `pnpm test:integration` runtime across the umbrella's lifetime.
- **NFR2.** Generated `contract.d.ts` file sizes do not 2x compared to pre-S1 baseline. The new nested shape adds depth but should not balloon the type bytes.
- **NFR3.** S2's runtime qualification adds at most one identifier-lookup hop per query — no quadratic re-traversal of the storage IR per query.
- **NFR4.** S3's explicit-namespace surface compiles in TypeScript without ballooning the inferred `Db<C>` type beyond what S2 already produces. Verified by a tsc trace if the bound is breached.

# Constraints + Assumptions

- **A1.** PR #534 (TML-2520) is merged into `main`. Met as of `66da80f96`.
- **A2.** The Supabase integration consumes this substrate. Specifically, the Supabase pack will register pack-contributed entity kinds for `policy` (RLS) and `role` through the S1-delivered descriptor mechanism. Verified by Supabase initiative's own project planning, not this umbrella.
- **A3.** Default-namespace fallback (S2) is sufficient for consumers on default-namespace-only contracts. Falsified if consumers start writing multi-namespace contracts before S3 lands — would force a deprecation conversation about the flat DSL surface. Mitigation: document the namespace-aware surface as a planned addition.
- **A4.** S1's slice plan holds without re-shaping. *(Resolved — S1 closed; durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md).)* S1's assumptions held without forcing an umbrella-level re-sequencing.

# Open Questions

These are residual umbrella-level questions; sub-project / slice specs own their own open questions.

1. **Should the umbrella's close-out absorb the legacy-project-folders cleanup**, or is that a separate housekeeping pass? Working position: **absorb at close-out** — `projects/` is transient per drive discipline, and the umbrella's close-out is the natural moment to archive `projects/target-extensible-ir/`, `projects/namespace-exemplar/`, and similar rolled-up artifacts. Alternative: file a separate cleanup project. Cost-benefit favours absorption.
2. **Does S2 produce a long-lived ADR**, or is the default-namespace family-façade convention narrow enough to live only in S2's slice spec? Working position: **S2 produces an ADR if execution surfaces enough design content to warrant one** — likely yes, because "family façade hardcodes its own default namespace" is a load-bearing convention future families will need to know.
3. **Does S3 produce a long-lived ADR** about the namespace-aware DSL/ORM surface shape? Working position: **likely yes** — the explicit-namespace surface design is what every future authoring affordance will follow.
4. **Linear ticket creation for the umbrella's S1 slices.** S1's plan names 6 internal slices that need Linear tickets. Working position: **create all six during the Linear audit pass that runs alongside this umbrella's plan drafting** so the audit pass resolves duplicate/stale tickets in the same touch.

# References

- **Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
- **Tracking tickets:**
  - [TML-2520](https://linear.app/prisma-company/issue/TML-2520) — namespace exemplar; PR #534 merged at commit `66da80f96` (predecessor, not in umbrella scope)
  - [TML-2584](https://linear.app/prisma-company/issue/TML-2584) — contract IR planes (S1)
  - [TML-2605](https://linear.app/prisma-company/issue/TML-2605) — runtime SQL qualification (S2)
  - [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — explicit namespace-aware DSL surface (S3)
  - [TML-2537](https://linear.app/prisma-company/issue/TML-2537) — target-contributed PSL blocks (separate project; out of umbrella)
- **S1 (closed) durable decisions:**
  - [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) (S1's spec/plan were transient and removed at S1's close-out)
- **Downstream consumer (out of scope):** `projects/supabase-integration/` — the initiative this umbrella's substrate enables.
- **Reference docs:**
  - [Architecture Overview](../../docs/Architecture%20Overview.md)
  - [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) — the prior art S1's two-plane reshape generalises
