# ADR (draft) — Always-qualified builder surface with per-facade default-namespace projection

**Status:** Draft (project-local; migrates to `docs/architecture docs/adrs/` with a final number at project close-out M2)
**Date:** 2026-06-09
**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550)
**Builds on:** [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) (TML-2605)

---

## A concrete example

A Postgres contract declares `auth.User` and `public.Profile`. The builder surface is **always qualified** — the namespace is named at the call site:

```ts
import { sql, orm } from './db'; // the builder outputs

await sql.auth.users.select({ id: true, email: true }).build().execute();
await orm.public.Profile.find({ where: { id } });
```

There is no `sql.users` and no `orm.Profile` at the builder layer — namespace selection is mandatory. Flat ergonomics, where a target has only one namespace, are recovered at the **facade**, which statically returns the right shape for its target:

```ts
// Postgres facade — multi-namespace target: the facade exposes the qualified surface.
import { db } from './db';
await db.sql.public.users.select(...).build().execute(); // db.sql.users is a compile error
await db.orm.public.User.find(...);

// SQLite facade — single-namespace target: the facade aliases db to the unbound facet.
import { db } from './db';
await db.sql.users.select(...).build().execute(); // flat works: db.sql === sql.__unbound__
await db.orm.User.find(...);                       // db.orm === orm.__unbound__
```

The same bare name on Mongo (`db.orm.users`) works because the Mongo ORM client is keyed by **root model name**, not by namespace — it never had a flat-vs-qualified distinction to remove.

---

## Decision

### 1. The builder surface is always qualified

The SQL builder (`@prisma-next/sql-builder`) and ORM client (`@prisma-next/sql-orm-client`) expose **per-namespace facets only**. The flat by-bare-name accessors are removed:

- `Db<C>` is the namespaced-only mapped type `{ readonly [Ns in keyof C['storage']['namespaces']]: Namespace<C, Ns> }`. The prior additive flat intersection member (`{ [Name in TableNamesAcrossNamespaces<C>]: TableProxy<C, Name> }`) is gone.
- `OrmClient<C>` is `NamespacedClientMap<C>` (`{ [Ns in keyof C['domain']['namespaces']]: OrmNamespace<C, …, Ns> }`). The prior flat `ModelCollectionMap` member is gone.
- At runtime, the `sql()` / `orm()` proxies resolve namespace facets only. The non-namespace `get()` branch (the old `resolveTableForFlatName` / `flatCollection` fallback) is deleted; a non-namespace property yields `undefined` at runtime and a compile error at the type level.

This is the deliberate breaking change: namespace selection is explicit at the builder layer. It separates **navigation** (which namespace's table/model?) from **ergonomics** (don't make me type the namespace when there's only one) — the former is a builder concern, the latter a facade concern.

**Retained — not deleted:** `UnboundTables<C>` and `TableNamesAcrossNamespaces<C>` (in `sql-builder`'s `types/db.ts`). After ADR 223's symmetric-domain rebase they no longer mean "`__unbound__`'s tables"; they mean **"the set of tables across all namespaces"** and are load-bearing generic constraints for `TableProxy`, `TableProxyImpl`, and the `query-builder` package (`Ref`, `Root`, `SelectBuilder`, `selection.ts`). Only the flat *member* of `Db<C>` and the flat runtime branch were removed; these helper types stay.

### 2. The facade projects its own default-namespace shape — statically, per facade

Each orchestration facade returns the right ergonomic surface for **its** target, decided statically by the facade itself:

| Facade | Target shape | `db.sql` / `db.orm` |
|---|---|---|
| Postgres (`@prisma-next/postgres`) | multi-namespace | the qualified builder outputs unchanged: `db.sql = sql`, `db.orm = orm`. Call sites qualify (`db.sql.public.users`); flat is a compile error. |
| SQLite (`@prisma-next/sqlite`) | single-namespace | aliased to the unbound facet: `db.sql = sql[UNBOUND_NAMESPACE_ID]`, `db.orm = orm[UNBOUND_NAMESPACE_ID]`. Flat `db.sql.users` / `db.orm.User` work again. |

The same applies to the transaction context (`tx.sql` / `tx.orm`) and the Postgres `prepare(...)` callback's `sql` parameter — each re-typed to the facade's projected shape.

**There is no shared projection helper and no runtime descriptor read.** The SQLite facade names `UNBOUND_NAMESPACE_ID` (from `@prisma-next/framework-components/ir`) directly; the Postgres facade returns the qualified outputs directly. The projection is a compile-time-and-runtime fact each facade owns about itself.

#### Why static-per-facade, not descriptor-driven

The project's acceptance criteria originally framed the projection as a single shared helper "driven solely by the target descriptor's `defaultNamespaceId`" (unbound ↔ flat alias; non-unbound ↔ qualified), with no per-target switch. That mechanism was **rejected as over-engineering** for these reasons:

- **The discriminator is not reachable from anything the facade runtime consumes.** Per ADR 223, `defaultNamespaceId` is a *control-plane* fact owned by the target descriptor and consumed at *authoring* time. The **runtime** target descriptor (`RuntimeTargetDescriptor`) deliberately omits it — TML-2766 minimised the runtime descriptor to `kind/familyId/targetId/id/version/capabilities` so the runtime closure stays free of the authoring/`/pack` chain. The emitted `contract.json` carries no `defaultNamespaceId` either. So a facade cannot read the discriminator at runtime, and `TargetPackRef.defaultNamespaceId` is typed `string` (not a literal), so a type-level conditional cannot discriminate off it.
- A shared, descriptor-literal-driven helper would have required either a `framework-components` substrate-type change (widen the runtime descriptor to carry `defaultNamespaceId` as a generic literal) or pulling the authoring closure into the runtime bundle (a TML-2766 regression). Neither is justified for a two-arm projection.
- **The intent of the rejected AC is satisfied anyway.** There is no per-target *branch/switch* in shared code — the dispatch point is simply "each facade is statically its own target", which is the simplest expression of "unbound ↔ flat / non-unbound ↔ qualified". A facade knows its own target at authoring time; encoding that as a static return is correct and needs no descriptor plumbing.

> **Spec reconciliation (close-out note).** This supersedes the project spec's AC5 wording ("projection driven solely by the target descriptor's `defaultNamespaceId`… no per-target switch") and AC4's "Mongo aliased to `orm.__unbound__`" wording (see point 3). The implemented design satisfies the *outcome* both AC4 and AC5 describe (flat ergonomics on single-namespace targets; qualified-only on multi-namespace; no shared per-target switch). Rewording the spec ACs is a project close-out task, not part of this slice.

### 3. Mongo is a root-keyed exception — already flat, never cut

The Mongo ORM/query surfaces were **never part of the namespaced-only cut**, and do not need to be:

- `MongoOrmClient<TContract>` is keyed by `TContract['roots']` (root **model** names: `db.orm.users`, `db.orm.tasks`), not by namespace. It is already a flat model-collection map — there was no flat default-namespace fallback to remove.
- `mongoQuery(...)`'s output (`db.query`) is a **method API** (`{ from(rootName), rawCommand(cmd) }`), not a namespace-keyed (or even root-keyed) property map. There is nothing to alias.
- Mongo is single-namespace (`__unbound__`); its roots already carry their `{ namespace, model }` coordinate, so there is no multi-namespace ambiguity for the always-qualified machinery to solve.

The Mongo facade therefore needs no projection change: it already delivers flat `db.orm.<Model>`, which is the desired end-state for a single-namespace target. (This documents the actual design; the project spec's AC4 "Mongo aliased to `orm.__unbound__`" describes a mechanism that does not apply because the Mongo ORM is root-keyed, not namespace-keyed.)

### 4. `Db<C>` per-namespace facet construction

The namespaced surface is a **two-level proxy** over the existing table/model accessors — thin, no parallel resolution pipeline:

- **Types.** `Namespace<C, NsId> = { readonly [Name in keyof C['storage']['namespaces'][NsId]['entries']['table'] & string]: TableProxy<C, Name> }` is one namespace's tables keyed by bare table name. `Db<C>` maps it over every storage namespace id. The ORM mirror is `OrmNamespace<C, Collections, NsId>` (one domain namespace's models keyed by bare model name), mapped by `NamespacedClientMap<C>` over every domain namespace id.
- **Runtime.** The outer proxy's `get(prop)` checks `Object.hasOwn(storage.namespaces, prop)` (resp. `domain.namespaces`); on a hit it returns an inner facet proxy whose `get(name)` resolves the table/model **within that namespace coordinate** (`resolveTableInNamespace(storage, namespaceId, name)`; the ORM facet builds its collection at `namespaceId`). The coordinate is threaded into the existing `TableProxyImpl` / `Collection`, so qualified SQL emission and namespace-aware ORM execution reuse the TML-2605 machinery — there is no parallel qualification pipeline.

Indexing a *generic* `Db<TContract>` value (e.g. inside a facade generic over `TContract`) widens the namespace key to `string`, so the SQLite facade bridges the generic builder value to its literal-keyed facet type with a single narrowed cast (the unbound namespace always exists on a SQLite contract). For concrete contracts (the common case) the facet index is exact and needs no cast.

### 5. Wiring sites and prerequisite

- **Prerequisite:** [TML-2605 / ADR 223](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) — runtime identifier-qualification. The per-namespace facets call into that machinery parameterised by namespace coordinate; this project removes the builder-layer flat fallback ADR 223 left as a single-namespace bridge.
- **Builder cut:** `packages/2-sql/4-lanes/sql-builder` (`types/db.ts`, `runtime/sql.ts`, `runtime/resolve-table.ts`); `packages/3-extensions/sql-orm-client` (`src/orm.ts`).
- **Facade projection:** `packages/3-extensions/postgres/src/runtime/postgres.ts` (qualified passthrough), `packages/3-extensions/sqlite/src/runtime/sqlite.ts` (`__unbound__` facet alias). The Mongo facade (`packages/3-extensions/mongo/src/runtime/mongo.ts`) is unchanged (root-keyed).

---

## Context

ADR 223 made a target's default namespace a static descriptor fact consumed at authoring time, and explicitly deferred multi-namespace flat access and bare-name collision ergonomics to [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — this project. ADR 223 left a single-namespace bridge at the builder layer: a bare name resolved through the contract's sole namespace, with the flat surface kept alongside.

That bridge conflated navigation with ergonomics and produced a surface that was asymmetric between targets that have namespaces and targets that don't. This project removes the bridge: the builder layer becomes uniformly qualified, and ergonomic flat access becomes a facade responsibility — composable with the facade's other concerns (session binding, multi-tenant scoping) without distorting the builder's type construction.

The one design fork during implementation was *how* the facade decides flat-vs-qualified. The spec assumed a descriptor-driven shared helper; recon showed the discriminator (`defaultNamespaceId`) is, by ADR 223 + TML-2766, an authoring/control-plane fact absent from the runtime descriptor the facade consumes. Rather than plumb it into the runtime substrate, the implemented design lets each facade state its own shape statically — strictly simpler, and faithful to the outcome the spec wanted.

---

## Consequences

- **Positive:** Navigation and ergonomics are cleanly separated. The builder layer has one shape (qualified); ergonomic defaults live where they compose (the facade). Multi-namespace contracts are fully reachable (`sql.<ns>.<table>`, `orm.<ns>.<Model>`), including same-bare-name-in-two-namespaces.
- **Positive:** Single-namespace facade users (SQLite, Mongo) keep flat `db.sql.<table>` / `db.orm.<Model>` unchanged — the breaking change is invisible to them.
- **Positive:** No `framework-components` substrate change and no runtime-bundle regression — the facade projection adds zero descriptor plumbing, consistent with TML-2766.
- **Breaking change (deliberate):** Consumers calling `orm.<Model>` / `sql.<table>` directly on the builder outputs, or `db.sql.<table>` / `db.orm.<Model>` on a **multi-namespace (Postgres)** facade, must qualify (`sql.public.<table>`, `orm.public.<Model>`, `db.sql.public.<table>`, …). Recorded as a user upgrade-instructions entry (`qualify-flat-builder-accessors`, 0.12 → 0.13).
- **Unknown access returns `undefined`, not a throw.** The `sql()` / `orm()` proxy `get` traps return `undefined` for an unknown namespace, table, or model rather than throwing. Throwing inside a `Proxy` trap breaks ordinary JS property probing (e.g. `then`/`toJSON`/`constructor` checks done by frameworks and serializers on whatever value flows past), so the always-qualified contract is enforced at the **type level** (unknown access is a compile error) and the runtime stays permissive.
- **Trade-off:** A facade generic over `TContract` needs one narrowed cast to bridge the generic-index widening to its literal-keyed facet type. Concrete-contract consumers are unaffected.

---

## References

- [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- Linear: [TML-2550](https://linear.app/prisma-company/issue/TML-2550) (this project), [TML-2605](https://linear.app/prisma-company/issue/TML-2605) (prerequisite), TML-2766 (runtime-descriptor minimisation)
- Project spec: [`spec.md`](./spec.md) (AC4 / AC5 reconciliation above)
