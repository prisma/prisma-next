# Summary

Deliver target-extensible IR + first-class namespaces — the substrate the downstream Supabase integration depends on. S1 (closed) proved the two-plane IR model and the pack-contributed entity-kind mechanism, but shipped storage under a `namespaces` wrapper and never wired the `domain` plane. The remaining work, re-planned from scratch as a single sequential stack: canonicalize the IR to ADR 221's shape, make Postgres `public`-by-default at the PSL interpreter, qualify identifiers at runtime with a default-namespace fallback, then (additive, deferrable) add the explicit namespace-aware DSL/ORM surface.

# Purpose

Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The contract IR reaches its canonical two-plane shape (`contract.{domain, storage}.<ns>.<entityKind>.<entityName>`); un-namespaced Postgres models default to the `public` namespace; runtime SQL and the DSL/ORM qualify identifiers through a default-namespace fallback so existing single-namespace consumers experience zero query-API breakage; the explicit namespace-aware surface (`db.sql.auth.user`) lands later as purely additive work.

# At a glance

This is the umbrella for the work that started as PR #534 (TML-2520 namespace exemplar, merged), continued through the S1 sub-project (contract-ir-planes, closed), and now completes the namespace story. The re-planned composition:

```text
┌────────────────────────────────────────────────────────────────────┐
│ S1 — contract-ir-planes (sub-project, TML-2584)        CLOSED      │
│  Two-plane IR model + pack-contributed entity-kind mechanism +     │
│  Postgres enum exemplar. 5 merged slices. ADR 221.                 │
│  Did NOT finish: storage still under a `namespaces` wrapper;       │
│  `domain` plane never wired.                                       │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ S2 — IR canonicalization (sub-project)                 → ACTIVE    │
│  GAP 1: drop the storage.namespaces wrapper (storage.<ns>)         │
│  GAP 2: wire the domain plane (contract.domain.<ns>.{...})         │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ S3 — Postgres public-by-default at the PSL interpreter (slice)     │
│  Un-namespaced models → `public` namespace; `__unbound__` becomes  │
│  an explicit PSL opt-in; hardcoded `public`-prefix logic deleted.  │
│  Regenerate Postgres contract artifacts.                           │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ S4 — runtime qualification + default-ns fallback (slice, TML-2605) │
│  Runtime SQL emits `"public"."user"`; DSL/ORM resolves through a   │
│  per-family default namespace so legacy query code is untouched.   │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ S5 — explicit-namespace DSL/ORM (slice, TML-2550)     additive     │
│  db.sql.auth.user, db.auth.User. Purely additive on S4. Deferrable.│
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Downstream: Supabase integration initiative consumes
       this substrate. Out of this umbrella's scope.
```

Existing consumers on a single-default-namespace contract write zero query-code changes across the must-ship stack (S2–S4). Multi-namespace contracts that want explicit per-namespace navigation opt in to S5 when it lands.

# Scope

## In scope

- **S2 — IR canonicalization to the ADR-221 shape.** Sub-project, two slices. **GAP 1** ([TML-2747](https://linear.app/prisma-company/issue/TML-2747)): drop the `storage.namespaces.<ns>` wrapper so storage is indexed `storage.<ns>.<entityKind>.<entityName>`. **GAP 2**: wire the `domain` plane so `models` / `valueObjects` / `types` move under `contract.domain.<ns>.{...}`. Closes S1's unfinished FR2.
- **S3 — Postgres public-by-default at the PSL interpreter.** Un-namespaced Postgres models interpret as the `public` namespace; `__unbound__` becomes an explicit PSL opt-in. Delete the hardcoded `"public".`-prefixing logic. Regenerate Postgres contract artifacts (demo, examples, fixtures). Ticket created at pickup.
- **S4 — runtime SQL qualification + default-namespace DSL/ORM fallback.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate (Postgres: `"public"."user"`; SQLite: unqualified `"user"`; Mongo: collection key in correct namespace). DSL/ORM keeps its flat-by-name surface (`db.sql.<table>`, `db.<Model>`); every lookup resolves through a per-family default namespace (`'public'` for Postgres; `'__unbound__'` for Mongo/SQLite) hardcoded in the family façade function. Single PR. Tracking ticket [TML-2605](https://linear.app/prisma-company/issue/TML-2605).
- **S5 — explicit namespace-aware DSL/ORM surface.** Adds `db.sql.<ns>.<table>` and `db.<ns>.<Model>` for explicit multi-namespace navigation. Purely additive on S4 — default-namespace lookups keep working unchanged. Single PR, **deferrable**. Tracking ticket [TML-2550](https://linear.app/prisma-company/issue/TML-2550).

## Non-goals

- **First-class Postgres enum user affordances.** Typed `Role.member` references, `db.enums.X` runtime surface, codec value-narrowing, `@default(EnumName.value)` PSL lowering. Owned by the separate `postgres-enum-finishing` project; consumes this umbrella's substrate.
- **Pack-contributed PSL block grammar** (`policy {…}`, `role {…}`, etc.). Owned by [TML-2537](https://linear.app/prisma-company/issue/TML-2537) (target-contributed top-level PSL blocks). Independent project.
- **PostgresRLS** (policies, roles, grants, row-level security DDL). Independent project; depends on TML-2537 substrate. The Supabase initiative's marquee feature, but not this umbrella's deliverable.
- **The `@prisma-next/supabase` extension pack.** Lives in the downstream Supabase integration initiative; consumes this umbrella's substrate.
- **Auth roles, JWT, RBAC modelling.** Downstream Supabase initiative.
- **Mongo enum support.** Mongo lacks the native type; emulating via application-side validation is out of scope here.
- **SQLite native enums** via CHECK-constraint emulation. Future axis; if added, follows the same pack-contributed entity-kind pattern S1 established.
- **Cross-target portability of Postgres-only features.** Postgres-pack-contributed entity kinds are Postgres-only by design.
- **The S1-deferred structural follow-ups** ([TML-2743](https://linear.app/prisma-company/issue/TML-2743) findSqlTable, [TML-2744](https://linear.app/prisma-company/issue/TML-2744) stripNamespaceKinds, [TML-2745](https://linear.app/prisma-company/issue/TML-2745) query-builder UnboundTables). Tracked independently; not gating this umbrella.
- **`projects/` folder cleanup** of older rolled-up project folders (`target-extensible-ir/`, `namespace-exemplar/`). Cleanup happens at this umbrella's close-out per drive's `projects/` transient-folder discipline.

# Approach

The remaining work is one sequential stack — re-planned from scratch after S1 closed, because what S1 actually shipped diverged from ADR 221's prose.

**S2 makes the emitted IR honestly match ADR 221.** S1 proved the two-plane model in the type system but shipped storage under a `namespaces` wrapper (`contract.storage.namespaces.<ns>.tables`) and left the `domain` plane unwired (models/valueObjects/types flat at the contract root). GAP 1 drops the wrapper; GAP 2 wires the domain plane. GAP 1 is on the critical path with S4 (both touch the storage-walk / identifier-emission paths), so it leads. GAP 2 is pure shape-correctness — it doesn't unblock runtime — but it lands in-line so the IR matches the ADR before feature work resumes.

**S3 makes `public` a real namespace.** Today every single-namespace Postgres contract uses the `__unbound__` sentinel, and runtime fakes qualification by string-prefixing `"public".`. S3 flips the PSL interpreter so un-namespaced models default to the `public` namespace, makes `__unbound__` an explicit opt-in, and deletes the hardcoded prefix logic. This is the prerequisite for S4 to emit `"public"."user"` honestly (from a namespace that exists in the contract) rather than by interpolation. It regenerates the in-repo Postgres contract artifacts to carry the `public` namespace.

**S4 makes the namespace IR useful for runtime queries.** Runtime SQL qualifies identifiers (no more `SELECT * FROM user` when the table lives in `auth`); DSL/ORM reads through a per-family default-namespace fallback (`db.sql.user` resolves to `public.user` for Postgres now that S3 makes `public` real, `__unbound__.user` for Mongo/SQLite). The fallback is the **load-bearing backward-compatibility mechanism**: existing single-default-namespace consumers experience no query-API breakage.

**S5 adds the explicit namespace-aware surface.** `db.sql.auth.user`, `db.auth.User`. Purely additive on S4 — default-namespace lookups keep working — so it can land independently or defer. Multi-namespace consumers opt in when they need explicit navigation.

The composition's two load-bearing properties:

1. **The must-ship scope (S2 + S3 + S4) introduces zero user-facing query-API breakage.** Existing consumers on default-namespace contracts write the same query code they wrote before this umbrella; their regenerated contracts change shape, but their query code does not.
2. **S1's substrate makes future pack-contributed entity kinds cheap.** RLS policies, roles, sequences, materialised views — every Postgres-only feature future work needs to ship is one descriptor registration plus a slot key. The Supabase integration pays only the per-feature cost, not the per-feature substrate cost.

# Project Definition of Done

- [ ] **PDoD1.** Must-ship units (S2, S3, S4) delivered. The additive unit (S5) delivered, or explicitly deferred to a sibling initiative with the deferral recorded in `projects/target-extensible-ir-namespaces/deferred.md`.
- [ ] **PDoD2.** The emitted contract IR matches ADR 221's canonical shape: storage is `contract.storage.<ns>.<entityKind>` with no `namespaces` wrapper segment, and the domain plane is wired as `contract.domain.<ns>.{models, valueObjects, types}`. Verified by `pnpm fixtures:check` against regenerated artifacts plus a grep gate confirming no `storage.namespaces` wrapper path remains. Delivered by S2.
- [ ] **PDoD3.** Un-namespaced Postgres models default to the `public` namespace at the PSL interpreter; opting a model into `__unbound__` is an explicit PSL affordance; the hardcoded `"public".`-prefixing logic is deleted. Verified by an authoring round-trip test and a grep gate over the removed prefix logic. Delivered by S3.
- [ ] **PDoD4.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. The demo's emitted SQL contains `"public"."user"` (Postgres) / `"user"` (SQLite no-op) / `auth.users` (Mongo collection key) consistently. Delivered by S3 (makes `public` real) + S4 (renders it).
- [ ] **PDoD5.** Existing consumers on single-default-namespace contracts experience zero query-API breakage caused by this umbrella's work. Verified by: (a) demo apps' query code under `examples/prisma-next-demo/src/queries/` compiles and runs unchanged across S3+S4 landings, and (b) a regression test demonstrates `db.sql.user` resolves to the default namespace's `user` table with no explicit namespace argument.
- [ ] **PDoD6.** A multi-namespace Postgres contract is authorable (PSL + TS DSL), emittable, and queryable end-to-end. Verified by an integration test exercising a two-namespace contract through PSL authoring → emission → runtime DSL query → SQL execution against PGlite. Delivered by S2 (shape) + S4 (queryable).
- [ ] **PDoD7.** The pack-contributed entity-kind substrate is exercised end-to-end (Postgres enum off the framework-shared slot). Inherited from S1 (closed).
- [ ] **PDoD8.** Long-lived ADRs migrated to `docs/architecture docs/adrs/`: S1's ADR 221 (already migrated); any ADR S2–S4 produce about the canonical-shape migration, the Postgres default-namespace policy, or the default-namespace family-façade convention (if execution surfaces enough design to warrant one).
- [ ] **PDoD9.** Linear Project "Target-Extensible IR + Namespaces" marked Completed (auto via GitHub PR-merge integration when the close-out PR lands).
- [ ] **PDoD10.** Rolled-up predecessor project folders (`projects/target-extensible-ir/`, `projects/namespace-exemplar/`) archived or deleted with long-lived contents migrated to `docs/`; the umbrella's own `projects/target-extensible-ir-namespaces/` folder deleted at close-out; repo-wide references stripped / replaced with `docs/` links.

# Functional Requirements

- **FR1.** Pack-contributed entity-kind mechanism exists at the framework level. Delivered by S1 (closed).
- **FR2.** Contract IR follows the canonical shape `contract.{domain, storage}.<ns>.<entityKind>.<entityName>` everywhere, with no `namespaces` wrapper segment in the storage plane and the domain plane wired. Entity coordinate `(namespaceId, entityKind, entityName)` is the canonical addressing primitive. Substrate delivered by S1; canonical shape completed by **S2**.
- **FR3.** Postgres enum migrates to a Postgres-pack-contributed entity slot; framework-shared `types` slot deleted as a load-bearing surface. Delivered by S1 (closed).
- **FR4.** The Postgres PSL interpreter interprets models with no explicit namespace as belonging to the `public` namespace; `__unbound__` is an explicit PSL opt-in. Hardcoded `public`-prefixing logic deleted. Delivered by **S3**.
- **FR5.** Runtime SQL emission qualifies every identifier by its namespace's family-specific DDL coordinate. Delivered by **S4**.
- **FR6.** DSL/ORM exposes the existing flat-by-name surface (`db.sql.<table>`, `db.<Model>`), with every lookup resolving through a per-family default namespace hardcoded in the family façade function. Delivered by **S4**.
- **FR7.** Explicit namespace-aware DSL/ORM surface (`db.sql.<ns>.<table>`, `db.<ns>.<Model>`) ships as purely additive on FR6. Delivered by **S5** (deferrable).

# Non-Functional Requirements

- **NFR1.** No regression in `pnpm test:packages` or `pnpm test:integration` runtime across the umbrella's lifetime.
- **NFR2.** Generated `contract.d.ts` file sizes do not 2x compared to the pre-S2 baseline. The canonical nested shape changes depth but should not balloon the type bytes.
- **NFR3.** S4's runtime qualification adds at most one identifier-lookup hop per query — no quadratic re-traversal of the storage IR per query.
- **NFR4.** S5's explicit-namespace surface compiles in TypeScript without ballooning the inferred `Db<C>` type beyond what S4 already produces. Verified by a tsc trace if the bound is breached.

# Constraints + Assumptions

- **A1.** S1 is closed; ADR 221 captures the durable decisions; the two-plane IR substrate, entity coordinate, and pack-contributed entity-kind mechanism exist.
- **A2.** The Supabase integration consumes this substrate. The Supabase pack will register pack-contributed entity kinds for `policy` (RLS) and `role` through the S1-delivered descriptor mechanism. Verified by the Supabase initiative's own planning, not this umbrella.
- **A3.** Flipping the Postgres PSL default from `__unbound__` to `public` (S3) requires regenerating the in-repo Postgres contract artifacts. This umbrella owns that regeneration; downstream consumers whose *source* shape changes get upgrade instructions.
- **A4.** Default-namespace fallback (S4) is sufficient for consumers on default-namespace-only contracts. Falsified if consumers start writing multi-namespace contracts before S5 lands — would force a deprecation conversation about the flat DSL surface. Mitigation: document the namespace-aware surface as a planned addition.
- **A5.** GAP 2 (domain plane) is pure shape-correctness and does not unblock the runtime story. It stays in must-ship to honor ADR 221, but is the first deferral candidate under schedule pressure.

# Open Questions

These are residual umbrella-level questions; slice specs own their own.

1. **Does S3 warrant a long-lived ADR** about the Postgres default-namespace policy (`public`-by-default, `__unbound__` opt-in)? Working position: **likely yes** — it's a load-bearing authoring convention that changes the meaning of every existing Postgres schema.
2. **Does S4 produce a long-lived ADR** about the default-namespace family-façade convention? Working position: **likely yes** — "family façade hardcodes its own default namespace" is a load-bearing convention future families will need to know.
3. **Does S5 produce a long-lived ADR** about the namespace-aware DSL/ORM surface shape? Working position: **likely yes** — the explicit-namespace surface design is what every future authoring affordance will follow.

# References

- **Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
- **Tracking tickets:**
  - [TML-2520](https://linear.app/prisma-company/issue/TML-2520) — namespace exemplar; PR #534 merged (predecessor, not in umbrella scope)
  - [TML-2584](https://linear.app/prisma-company/issue/TML-2584) — contract IR planes (S1, Done)
  - [TML-2747](https://linear.app/prisma-company/issue/TML-2747) — IR canonicalization GAP 1 (S2 first slice)
  - [TML-2605](https://linear.app/prisma-company/issue/TML-2605) — runtime SQL qualification (S4)
  - [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — explicit namespace-aware DSL surface (S5)
  - [TML-2537](https://linear.app/prisma-company/issue/TML-2537) — target-contributed PSL blocks (separate project; out of umbrella)
- **S1 (closed) durable decisions:**
  - [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- **Downstream consumer (out of scope):** the Supabase integration initiative this umbrella's substrate enables.
- **Reference docs:**
  - [Architecture Overview](../../docs/Architecture%20Overview.md)
  - [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) — prior art the two-plane reshape generalises
