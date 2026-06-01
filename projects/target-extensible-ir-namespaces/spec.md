# Summary

Deliver target-extensible IR + first-class namespaces — the substrate the downstream Supabase integration depends on. The contract-IR substrate (two planes, entity coordinate, pack-contributed entity kinds) is **closed**; the remaining work is a sequential stack of three named units: **domain-plane** (symmetric IR), **public-by-default** (Postgres PSL), and **runtime-qualification** (SQL + DSL/ORM fallback). The **explicit-dsl** surface (`db.sql.auth.user`) is **elevated out of this project** — required for Supabase but purely additive on `runtime-qualification`, so it is tracked standalone, runs in parallel, and does not gate close-out.

# Purpose

Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The IR reaches its canonical symmetric two-plane shape (both `domain` and `storage` as `{ …metadata?, namespaces }`); runtime SQL and the DSL/ORM qualify identifiers through a default-namespace fallback so existing single-namespace consumers experience zero query-API breakage. The explicit namespace-aware surface (`db.sql.auth.user`) is elevated out of this project and tracked standalone (see [TML-2550](https://linear.app/prisma-company/issue/TML-2550)): it is required for Supabase — whose colliding `auth.*` / `public.*` names the default-namespace fallback cannot disambiguate — but it is additive on `runtime-qualification` and parallelizable, so it lands separately rather than gating this project.

# At a glance

The umbrella began as PR #534 (TML-2520 namespace exemplar, merged). The IR substrate shipped as the closed **contract-ir-planes** sub-project ([ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)). Units are named, not numbered — the numbering drifted during replanning and added nothing.

```text
┌──────────────────────────────────────────────────────────────────┐
│ PR #534 — namespace exemplar + cross-namespace FKs   ✓ MERGED    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ contract-ir-planes (sub-project, TML-2584)          ✓ CLOSED     │
│  Two-plane IR + entity coordinate + pack-contributed entity-kind  │
│  mechanism + Postgres enum exemplar. Storage shipped with the     │
│  `storage.namespaces` envelope; domain plane left unwired.        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ domain-plane (slice, TML-2751)                       → IN PROGRESS │
│  Wire `contract.domain.namespaces.<ns>.{models,valueObjects}` to  │
│  mirror storage's envelope. Storage is unchanged (already right   │
│  on main). Framework domain has no `types`. Finishes the IR's     │
│  symmetry — ADR 221's remaining shape commitment.                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ public-by-default (slice)                            → NEXT       │
│  Postgres PSL interprets un-namespaced models as `public`;        │
│  `__unbound__` becomes explicit opt-in; hardcoded "public".       │
│  prefix logic deleted.                                            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ runtime-qualification (slice, TML-2605)         ← PROJECT CLOSES   │
│  Runtime SQL emits namespace-qualified identifiers; DSL/ORM reads │
│  through per-family default-namespace fallback so legacy query    │
│  code keeps working unchanged.                                    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Downstream: Supabase integration consumes this substrate.

      ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
      ┊ explicit-dsl (TML-2550)  — ELEVATED OUT of this project ┊
      ┊  db.sql.auth.user, db.auth.User. Additive on the         ┊
      ┊  default-namespace fallback; parallelizable. REQUIRED    ┊
      ┊  for Supabase (colliding auth.*/public.* names).         ┊
      ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```

Existing consumers on a single-default-namespace contract write zero query-code changes through runtime-qualification. Multi-namespace contracts that want explicit per-namespace navigation opt in to explicit-dsl, which ships separately (elevated out — see below).

# Scope

## In scope

- **contract-ir-planes — two-plane IR + pack-contributed entity-kind mechanism + Postgres enum exemplar.** Sub-project (closed; five merged slices). Durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md). Tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584). **What it left unfinished:** the domain plane was never wired — `models` / `valueObjects` remain flat at the contract root.
- **domain-plane — wire the symmetric domain plane.** Move flat `contract.models` / `contract.valueObjects` under `contract.domain.namespaces.<ns>.{models, valueObjects}`, mirroring storage's `{ storageHash, types?, namespaces }` envelope. Storage is **unchanged** (already correct on `main`). Framework domain has **no** `types` member — doc-scoped codec aliases stay on SQL `storage.types`. Tracking ticket [TML-2751](https://linear.app/prisma-company/issue/TML-2751).
- **public-by-default — Postgres `public` namespace at the PSL interpreter.** Un-namespaced Postgres models default to `public`; `__unbound__` becomes an explicit PSL opt-in; the hardcoded `"public".`-prefix logic is deleted; Postgres contract artifacts regenerated. Tracking ticket created at pickup.
- **runtime-qualification — runtime SQL qualification + default-namespace DSL/ORM fallback.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate (Postgres `"public"."user"`; SQLite unqualified `"user"`; Mongo collection key in the right namespace). DSL/ORM keeps the flat-by-name surface (`db.sql.<table>`, `db.<Model>`); every lookup resolves through a per-family default namespace (`'public'` for Postgres, `'__unbound__'` for Mongo/SQLite). Tracking ticket [TML-2605](https://linear.app/prisma-company/issue/TML-2605). **This is the last in-project unit; the project closes after it merges.**

## Non-goals

- **explicit-dsl — explicit namespace-aware DSL/ORM surface (`db.sql.<ns>.<table>`, `db.<ns>.<Model>`).** Elevated out of this project to [TML-2550](https://linear.app/prisma-company/issue/TML-2550). It is **required** for the Supabase integration — Supabase exposes colliding names across namespaces (`auth.users` alongside `public.users`) that the flat-by-name default-namespace fallback from `runtime-qualification` cannot disambiguate — but it is purely additive on that fallback, so it parallelizes with and ships after this project rather than gating its close-out. Not "deferrable" in the sense of optional; deferred *out* in the sense of decoupled.
- **First-class Postgres enum user affordances.** Typed `Role.member` references, `db.enums.X` runtime surface, codec value-narrowing, `@default(EnumName.value)` PSL lowering. Owned by the separate `postgres-enum-finishing` project; consumes this umbrella's substrate.
- **Pack-contributed PSL block grammar** (`policy {…}`, `role {…}`, etc.). Owned by [TML-2537](https://linear.app/prisma-company/issue/TML-2537). The Postgres pack reuses the framework's existing `enum {…}` block syntax for its enum migration.
- **PostgresRLS** (policies, roles, grants, row-level security DDL). Independent project; depends on TML-2537 substrate.
- **The `@prisma-next/supabase` extension pack.** Downstream Supabase integration initiative.
- **Auth roles, JWT, RBAC modelling.** Downstream Supabase initiative.
- **Mongo enum support.** Mongo lacks the native type; emulating via application-side validation is out of scope here.
- **SQLite native enums** via CHECK-constraint emulation. Future axis; would follow the pack-contributed entity-kind pattern.
- **Cross-target portability of Postgres-only features.** Postgres-pack-contributed entity kinds are Postgres-only by design.
- **`projects/` folder cleanup** of older rolled-up project folders. Happens at this umbrella's close-out.

# Approach

A sequential stack on top of the closed IR substrate:

**contract-ir-planes established the IR-shape substrate** every other unit depends on — the two-plane model, the canonical entity coordinate, and the pack-contributed entity-kind mechanism (proven by migrating Postgres enum off the framework-shared `types` slot). Durable decisions live in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md). It shipped storage in the correct `{ storageHash, types?, namespaces }` envelope but left the domain plane unwired.

**domain-plane finishes the IR's symmetry.** The contract-ir-planes sub-project closed claiming "IR follows `contract.{domain,storage}` everywhere" but only the storage plane reached its envelope; `models` / `valueObjects` are still flat at the contract root. domain-plane wires `contract.domain.namespaces.<ns>` to mirror storage. A prior attempt to instead *flatten storage* (closed PR #649) was the wrong direction — it mixed plane-level metadata into the namespace key-space and forced reserved-key machinery; ADR 221 was amended to prescribe the symmetric envelope on both planes. This unit does not touch runtime SQL.

**public-by-default makes `public` a real namespace.** Today un-namespaced Postgres models live under `__unbound__` and the runtime fakes a `"public".` prefix by string interpolation. This unit flips the PSL default so un-namespaced models *are* `public`, deletes the hardcoded prefix logic, and makes `__unbound__` an explicit opt-in — the prerequisite for runtime-qualification to emit `"public"."user"` honestly.

**runtime-qualification makes the namespace IR useful for queries.** Runtime SQL qualifies identifiers; the DSL/ORM reads through a per-family default-namespace fallback. The fallback is the **load-bearing backward-compatibility mechanism**: existing single-default-namespace consumers experience no query-API breakage.

**explicit-dsl adds the explicit surface — but is elevated out of this project.** `db.sql.auth.user`, `db.auth.User` — purely additive on the fallback. Because Supabase's colliding `auth.*` / `public.*` names make it required (the fallback resolves only a single default namespace by bare name), it is not optional; because it is additive it is decoupled. It is tracked standalone ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)) so it can run in parallel and ship after this project closes.

Two load-bearing properties:

1. **Zero user-facing query-API breakage.** Existing consumers on default-namespace contracts write the same query code throughout.
2. **The substrate makes future pack-contributed entity kinds cheap.** RLS policies, roles, sequences, materialised views — each is one descriptor registration through `AuthoringContributions.entityTypes`. Downstream work pays only the per-feature cost, not the per-feature substrate cost.

# Project Definition of Done

- [ ] **PDoD1.** All must-ship units (domain-plane, public-by-default, runtime-qualification) delivered. explicit-dsl is **not** a member of this project (elevated out to TML-2550) and does not gate close-out.
- [ ] **PDoD2.** Emitted contract IR matches ADR 221's symmetric shape: both `domain` and `storage` use `{ …metadata?, namespaces: { <ns>: … } }`; no flat `contract.models` at the root; storage retains `storage.namespaces`. Delivered by domain-plane.
- [ ] **PDoD3.** The pack-contributed entity-kind substrate is exercised end-to-end (Postgres enum). No hardcoded `'postgres-enum'` paths in `packages/1-framework/**`. Inherited from contract-ir-planes.
- [ ] **PDoD4.** Un-namespaced Postgres models default to the `public` namespace; `__unbound__` is an explicit PSL opt-in; hardcoded `"public".`-prefix logic deleted. Delivered by public-by-default.
- [ ] **PDoD5.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. The demo's emitted SQL contains `"public"."user"` (Postgres) / `"user"` (SQLite no-op) / `auth.users` (Mongo collection key). Delivered by public-by-default (makes `public` real) + runtime-qualification (renders it).
- [ ] **PDoD6.** Existing consumers on single-default-namespace contracts experience zero query-API breakage. Verified by: (a) demo query code under `examples/prisma-next-demo/src/queries/` compiles and runs unchanged, and (b) a regression test showing `db.sql.user` resolves to the default namespace's `user` table with no explicit namespace argument. Delivered by public-by-default + runtime-qualification.
- [ ] **PDoD7.** A multi-namespace Postgres contract is authorable (PSL + TS DSL), emittable, and queryable end-to-end against PGlite. Delivered by domain-plane (shape) + runtime-qualification (queryable).
- [ ] **PDoD8.** Long-lived ADRs migrated to `docs/architecture docs/adrs/`: ADR 221 (already migrated); any ADR produced by runtime-qualification (default-namespace family-façade convention). The explicit-dsl namespace-aware-surface ADR, if any, is owned by TML-2550 (elevated out).
- [ ] **PDoD9.** Linear Project "Target-Extensible IR + Namespaces" marked Completed.
- [ ] **PDoD10.** Rolled-up project folders (`projects/target-extensible-ir/`, `projects/namespace-exemplar/`) archived/deleted with long-lived contents migrated to `docs/`; the umbrella's own folder deleted; repo-wide references stripped.

# Functional Requirements

- **FR1.** Pack-contributed entity-kind mechanism exists at the framework level (`AuthoringContributions.entityTypes`). Delivered by contract-ir-planes.
- **FR2.** Contract IR follows symmetric plane envelopes `contract.{domain, storage}.namespaces.<ns>.<entityKind>.<entityName>` (plus plane-level metadata: `storageHash`, SQL-only `storage.types`). Framework domain has no `types`. Cross-references use object pairs; entity coordinate `(plane, namespaceId, entityKind, entityName)` is canonical. Coordinate + cross-ref encoding from contract-ir-planes; domain-plane envelope from domain-plane.
- **FR3.** Postgres enum migrated to a pack-contributed entity slot; framework-shared `storage.<ns>.types` deleted as a load-bearing surface. Delivered by contract-ir-planes.
- **FR4.** Un-namespaced Postgres models default to `public`; `__unbound__` is explicit PSL opt-in. Delivered by public-by-default.
- **FR5.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. Delivered by runtime-qualification.
- **FR6.** DSL/ORM exposes the flat-by-name surface (`db.sql.<table>`, `db.<Model>`), resolving through a per-family default namespace (`'public'` Postgres; `'__unbound__'` Mongo/SQLite). Delivered by runtime-qualification.
- **FR7.** Explicit namespace-aware DSL/ORM surface (`db.sql.<ns>.<table>`, `db.<ns>.<Model>`) ships as purely additive on FR6. **Elevated out of this project** — delivered by TML-2550, required for the Supabase integration. Listed here only to record the substrate relationship; it is not a deliverable of this project.

# Non-Functional Requirements

- **NFR1.** No regression in `pnpm test:packages` or `pnpm test:integration` runtime across the umbrella's lifetime.
- **NFR2.** Generated `contract.d.ts` file sizes do not 2x compared to the pre-substrate baseline.
- **NFR3.** runtime-qualification adds at most one identifier-lookup hop per query — no quadratic re-traversal of the storage IR per query.
- **NFR4.** explicit-dsl compiles in TypeScript without ballooning the inferred `Db<C>` type beyond what runtime-qualification produces. Verified by a tsc trace if the bound is breached.

# Constraints + Assumptions

- **A1.** PR #534 (TML-2520) is merged into `main`. Met as of `66da80f96`.
- **A2.** The Supabase integration consumes this substrate (registers `policy`/`role` entity kinds through the descriptor mechanism). Verified by the Supabase initiative's own planning.
- **A3.** Default-namespace fallback (runtime-qualification) is sufficient for consumers on default-namespace-only contracts. It is **not** sufficient for multi-namespace consumers with colliding names (e.g. Supabase's `auth.users` + `public.users`) — those require explicit-dsl (TML-2550, elevated out). Mitigation: explicit-dsl is tracked as a required, parallelizable follow-on, not a deferred maybe.
- **A4.** The IR substrate holds without re-shaping. *(Resolved — contract-ir-planes closed; ADR 221 amended for symmetric envelopes after the storage-flatten attempt was abandoned.)*

# Open Questions

1. **Does the close-out absorb the legacy-project-folders cleanup**, or is that a separate housekeeping pass? Working position: **absorb at close-out**.
2. **Does runtime-qualification produce a long-lived ADR** about the default-namespace family-façade convention? Working position: **likely yes** — "family façade hardcodes its own default namespace" is a convention future families will need.
3. **Does explicit-dsl produce a long-lived ADR** about the namespace-aware DSL/ORM surface shape? Working position: **likely yes** — but owned by TML-2550 now that explicit-dsl is elevated out of this project.

# References

- **Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
- **Tracking tickets:**
  - [TML-2520](https://linear.app/prisma-company/issue/TML-2520) — namespace exemplar; PR #534 (predecessor, out of umbrella scope)
  - [TML-2584](https://linear.app/prisma-company/issue/TML-2584) — contract IR planes (closed)
  - [TML-2751](https://linear.app/prisma-company/issue/TML-2751) — domain-plane (symmetric domain wiring)
  - [TML-2605](https://linear.app/prisma-company/issue/TML-2605) — runtime SQL qualification
  - [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — explicit namespace-aware DSL surface
  - [TML-2537](https://linear.app/prisma-company/issue/TML-2537) — target-contributed PSL blocks (separate project)
  - [TML-2747](https://linear.app/prisma-company/issue/TML-2747) — storage-flatten attempt (cancelled; closed PR #649)
- **Durable decisions:**
  - [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- **Downstream consumer (out of scope):** the Supabase integration initiative.
- **Reference docs:**
  - [Architecture Overview](../../docs/Architecture%20Overview.md)
  - [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
