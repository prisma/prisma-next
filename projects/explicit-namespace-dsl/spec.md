# Summary

This constituent project adds the **explicit namespace-aware DSL/ORM query surface** — `db.sql.<ns>.<table>` and `db.<ns>.<Model>` — so multi-namespace contracts can navigate to any namespace by name. It is a **launch blocker** for the [Supabase integration](../supabase-integration/README.md) ([TML-2503](https://linear.app/prisma-company/issue/TML-2503)): Supabase exposes colliding table names across namespaces (`auth.users` alongside `public.users`), and the flat-by-name default-namespace fallback from [runtime-qualification](../target-extensible-ir-namespaces/spec.md) ([TML-2605](https://linear.app/prisma-company/issue/TML-2605)) resolves only a single default namespace per bare name. Without explicit qualification there is no way to reach `auth.users`; everything collapses into one namespace. The surface is **purely additive** on that fallback — default-namespace consumers (`db.sql.<table>`, `db.<Model>`) see zero churn.

**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550)

# Context

## At a glance

A Supabase-shaped app contract spans at least `public` (app models) and `auth` (extension-pack models). Both namespaces can expose a `users` table. Authoring uses PSL namespace blocks; querying uses the TS runtime:

```prisma
// app/prisma/schema.prisma — authoring (PSL)
namespace public {
  model Profile {
    id     String @id @default(uuid())
    userId String @unique

    user supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@map("profile")
  }
}
```

```ts
// app/handlers.ts — runtime (TS; DSL/ORM surface is TS-only)
import { db } from './db';

// Explicit namespace navigation (this project):
await db.sql.public.profile.select({ id: true }).build().execute();
await db.sql.auth.users.select({ id: true, email: true }).build().execute();
await db.public.Profile.find({ where: { id: profileId } });
await db.auth.User.find({ where: { id: userId } });

// Default-namespace fallback (TML-2605) — unchanged for single-namespace apps:
await db.sql.profile.select({ id: true }).build().execute();
await db.Profile.find({ where: { id: profileId } });
```

After [TML-2605](../target-extensible-ir-namespaces/spec.md) lands, flat `db.sql.users` resolves through the per-family default namespace (`public` on Postgres). That is sufficient when only one namespace owns the bare name `users`. It is **not** sufficient when `auth.users` and `public.users` both exist — the fallback cannot disambiguate. This project adds the nested accessor path that names the namespace explicitly.

```text
Contract IR (nested namespaces on domain + storage planes)
         │
         ▼
TML-2605 — runtime-qualification (PREREQUISITE)
  • Runtime SQL qualifies identifiers by namespace coordinate
  • Flat db.sql.<table> / db.<Model> via default-namespace fallback
         │
         ▼
TML-2550 — explicit-namespace-dsl (THIS PROJECT)
  • db.sql.<ns>.<table> / db.<ns>.<Model> — additive explicit path
  • Reuses TML-2605 identifier-qualification machinery under the hood
         │
         ▼
TML-2503 — extension-supabase (CONSUMER; launch blocked without this)
  • Example app queries auth.* and public.* by explicit namespace
```

## Problem

**1. Colliding bare names are real in Supabase, not theoretical.** Postgres schemas `auth` and `public` both expose a `users` table. The framework must let app code query `auth.users` for admin flows and `public.profile` (with FK to `auth.users`) without renaming tables or abandoning namespaces.

**2. The default-namespace fallback is intentionally single-target.** [TML-2605](https://linear.app/prisma-company/issue/TML-2605) preserves backward compatibility: `db.sql.<table>` resolves through one per-family default namespace. That design is correct for legacy single-namespace consumers and wrong for multi-namespace disambiguation — expanding the fallback to "try every namespace until one matches" would be ambiguous at runtime and unsound at the type level.

**3. The explicit path must be ergonomic where collisions exist.** Supabase guarantees collisions in practice. A surface that merely *allows* `db.sql.auth.users` but still forces awkward workarounds on flat keys (or fails compilation for entire contracts) does not unblock launch. The open design decision (see [Open Questions](#open-questions)) is how flat-by-name keys behave when multiple namespaces share a name — the chosen option must make the collision case pleasant, not only legal.

## Approach

### Purely additive on TML-2605

Three properties:

- **No change to default-namespace call sites.** Code that today uses `db.sql.profile` / `db.Profile` continues to compile and resolve identically after this project merges, verified by regression tests against single-namespace fixtures.
- **Explicit accessors reuse the same qualification path.** Runtime resolution for `db.sql.auth.users` should not fork a parallel identifier pipeline — it names a namespace coordinate and delegates to the same machinery TML-2605 uses when emitting `"auth"."users"` vs `"public"."users"`.
- **Type-level `Db<C>` grows a per-namespace facet, not a breaking reshape.** `Db<C>` walks `contract.<plane>.namespaces` to produce namespace-keyed intermediates (`db.sql.<ns>`, `db.<ns>`) before table/model keys. The inferred type must remain tractable (see NFR2).

### SQL DSL shape

`db.sql.<namespaceId>.<tableName>` returns the same table-proxy kind the flat path returns today, but pinned to the named namespace's storage coordinate. Namespace identifiers match contract IR namespace keys (`public`, `auth`, `__unbound__`, etc.).

### ORM shape

`db.<namespaceId>.<ModelName>` mirrors the SQL shape on the domain plane: PascalCase model keys per namespace, consistent with how models are grouped under `contract.domain.namespaces.<ns>.models` after the [domain-plane](../target-extensible-ir-namespaces/slices/symmetric-domain-plane/spec.md) slice.

### Collision behaviour (decision at pickup)

With nested namespace IR, `auth.users` and `public.users` are both representable. How **flat** `db.sql.users` behaves when both exist is unsettled — see [Open Questions](#open-questions). This project implements the explicit path regardless; the decision affects whether flat keys union, error, or defer to explicit qualification only on collision.

### Verification story

A multi-namespace example (Supabase-shaped: `auth.users` + `public.users` + a `public.profile` FK) must be authorable (PSL), emittable (`contract.json`), and queryable end-to-end (PGlite or in-memory Postgres). The [extension-supabase](../extension-supabase/spec.md) example app is the long-term home; this project may land a focused fixture first if that unblocks integration work earlier.

# Requirements

## Functional Requirements

### Explicit SQL accessors

- **FR1.** For contracts with multiple storage namespaces, `db.sql.<namespaceId>.<tableName>` resolves to the table in that namespace and produces namespace-qualified SQL on execute (e.g. `"auth"."users"` on Postgres).
- **FR2.** Namespace identifiers exposed on `db.sql` match the contract's storage namespace keys. Unknown namespace ids are a compile-time error on the typed surface (or a fail-fast runtime error if the contract JSON is widened).
- **FR3.** Explicit SQL accessors support the same query-builder operations as the flat table proxies from TML-2605 (select/insert/update/delete/join paths already available on table proxies).

### Explicit ORM accessors

- **FR4.** For contracts with multiple domain namespaces, `db.<namespaceId>.<ModelName>` resolves to the model accessor in that namespace (find/create/update/delete APIs already on the flat ORM surface).
- **FR5.** ORM namespace keys align with `contract.domain.namespaces` keys and model names align with domain model keys within each namespace.

### Backward compatibility

- **FR6.** Single-default-namespace contracts: flat `db.sql.<table>` and `db.<Model>` behave identically before and after this change (no call-site edits required).
- **FR7.** No breaking change to emitted `contract.json` or `contract.d.ts` shape — this project only extends runtime/typing surfaces.

### Runtime resolution

- **FR8.** Runtime table/model lookup by explicit namespace uses the same identifier-qualification helper(s) introduced for TML-2605, parameterized by namespace coordinate — no second qualification implementation.
- **FR9.** Mis-typed namespace or table/model name fails fast with a diagnostic that names the namespace and suggests the explicit path when flat resolution is ambiguous (exact message left to implementer; must not silently hit the wrong table).

### Demonstration

- **FR10.** A committed multi-namespace example or integration test exercises: authoring in PSL with `namespace public { … }` plus extension-pack `auth` models; emit contract; query via `db.sql.auth.users` and `db.sql.public.profile` (or equivalent ORM calls) in one test run.

## Non-Functional Requirements

- **NFR1.** Hot-path cost for flat default-namespace lookups is unchanged — explicit namespace routing adds no overhead to call sites that never use `db.sql.<ns>`.
- **NFR2.** `Db<C>` inferred type size remains buildable: if explicit per-namespace facets blow TypeScript inference past practical limits, the implementer documents the mitigation (namespace allowlist, type simplification) in an ADR — see [Open Questions](#open-questions).
- **NFR3.** `pnpm lint:deps` passes; namespace accessor construction lives in the existing DSL/ORM client packages without new layering violations.
- **NFR4.** Test coverage: unit tests for type-level namespace keys (negative tests for unknown `ns`), integration tests for qualified SQL text on explicit paths, regression tests for FR6.

## Non-goals

- **Changing TML-2605's default-namespace fallback semantics** beyond what the collision-behaviour decision requires — prerequisite work stays in [runtime-qualification](../target-extensible-ir-namespaces/spec.md).
- **PSL syntax for namespace-qualified queries** — there is no PSL query surface; qualification in authoring remains namespace blocks + cross-contract refs ([B6](../supabase-integration/decisions.md)).
- **Supabase runtime role binding, JWT, `SET LOCAL`** — [extension-supabase](../extension-supabase/spec.md) / [runtime-target-layer](../runtime-target-layer/spec.md).
- **Cross-contract-space FK authoring** — [cross-contract-refs](../cross-contract-refs/spec.md).
- **Per-namespace `contract.d.ts` emission redesign** — emitter may stay single-file; explicit accessors are a runtime/typing concern unless pickup discovers emitter coupling.

## Sequencing constraints

| Constraint | Detail |
|---|---|
| **Hard prerequisite** | [TML-2605](https://linear.app/prisma-company/issue/TML-2605) (runtime-qualification) must merge first. This project reuses its identifier-qualification path. |
| **Umbrella placement** | Constituent of [Supabase integration](../supabase-integration/README.md); **launch blocker** for [TML-2503](https://linear.app/prisma-company/issue/TML-2503). |
| **Parallelism** | After TML-2605 lands, this project can run in parallel with other umbrella constituents that do not touch `Db<C>` accessor construction. It does **not** gate [target-extensible-ir-namespaces](../target-extensible-ir-namespaces/spec.md) close-out (explicit-dsl was elevated out for that reason). |
| **Delivery shape** | One PR, ~2–3 days engineering effort. |

# Acceptance Criteria

- [ ] **AC1.** `db.sql.<ns>.<table>` works for explicit multi-namespace navigation, including querying `auth.users` when `public.users` also exists in the same contract aggregate.
- [ ] **AC2.** `db.<ns>.<Model>` works for explicit multi-namespace ORM navigation with the same namespace keys as the SQL surface.
- [ ] **AC3.** Default-namespace consumers (`db.sql.<table>`, `db.<Model>` without an intermediate namespace key) see zero churn — existing demo queries and regression fixtures pass unchanged.
- [ ] **AC4.** A Supabase-shaped multi-namespace fixture is authorable (PSL), emittable, and queryable end-to-end (explicit paths used for the colliding `users` table).
- [ ] **AC5.** Collision-behaviour decision (Open Questions) is recorded in an ADR if execution surfaces enough design content; implementation matches the chosen option.
- [ ] **AC6.** `pnpm test:packages` and relevant integration tests green; `pnpm lint:deps` passes.

# Other Considerations

## TypeScript-only query surface

The DSL/ORM accessors are runtime TypeScript API. PSL leads for **authoring** (namespace blocks, models, policies); TS examples in this spec illustrate **query** usage only. That matches [prefer-psl-in-design-docs](../../.agents/rules/prefer-psl-in-design-docs.mdc) ordering: PSL for contract shape, TS where the capability is TS-only.

## Relationship to extension-supabase

[extension-supabase](../extension-supabase/spec.md) wraps the runtime in a role-bound facade (`asUser` / `asAnon` / `asServiceRole`). Explicit namespace accessors must compose through `RoleBoundDb` unchanged — role binding selects session context; namespace selection selects which table coordinate to query. No Supabase-specific fork of the accessor types.

## Cost

Touches primarily:

- DSL accessor type construction (`Db<C>` walking `contract.storage.namespaces`),
- ORM accessor type construction (domain namespaces),
- Runtime resolution wiring into TML-2605 helpers.

Estimated ~2–3 days, one reviewable PR. Upgrade instructions only if a breaking type change surfaces (working assumption: none).

# References

- [Umbrella — Supabase integration](../supabase-integration/README.md)
- [Umbrella overview — end-to-end narrative](../supabase-integration/overview.md)
- [Umbrella `decisions.md` — B6 reopenable namespace blocks](../supabase-integration/decisions.md)
- [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — this constituent (explicit namespace-aware DSL/ORM)
- [TML-2605](https://linear.app/prisma-company/issue/TML-2605) — prerequisite (runtime-qualification)
- [TML-2503](https://linear.app/prisma-company/issue/TML-2503) — blocked consumer (extension-supabase)
- [target-extensible-ir-namespaces](../target-extensible-ir-namespaces/spec.md) — IR + runtime-qualification umbrella; explicit-dsl elevated out
- [extension-supabase](../extension-supabase/spec.md) — integration package and example app
- [ADR 221 — Contract IR two planes](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) — namespace envelope shape explicit accessors reflect

# Open Questions

## Cross-namespace flat-by-name collision behaviour (resolve at pickup)

When both `auth.users` and `public.users` exist, how should **flat** `db.sql.users` / `db.users` behave?

| Option | Behaviour | Tradeoff |
|---|---|---|
| **(A) Union row types** | `db.sql.users` becomes `TableProxy<auth.users> \| TableProxy<public.users>` (ORM analogue for models). Narrow at use site. | Preserves flat ergonomics; pushes disambiguation to application code; TS complexity. |
| **(B) Qualify-on-collision only** | Flat key when globally unique; when colliding, flat key absent or untyped and explicit `db.sql.auth.users` required. | Simple mental model; flat path disappears exactly where Supabase needs help. |
| **(C) Compile-error on collision** | Contracts with cross-namespace name collisions fail typecheck unless all query sites use explicit namespaces. | Forces explicit qualification at authoring; may be heavy-handed for large contracts. |

**Headline requirement:** Supabase guarantees collisions exist in practice — the chosen option must make the collision case **ergonomic**, not merely legal. Decision lands in this issue's ADR if execution surfaces enough design content.

## ADR scope

Does this project produce a long-lived ADR for the namespace-aware DSL/ORM surface (beyond the collision decision)? **Working assumption: yes** if the collision decision or `Db<C>` construction pattern establishes conventions future families/extensions must follow.

## Example placement

Does the Supabase-shaped fixture live in this PR or only in extension-supabase? **Working assumption:** minimal integration test here; full example app stays with [TML-2503](https://linear.app/prisma-company/issue/TML-2503).
