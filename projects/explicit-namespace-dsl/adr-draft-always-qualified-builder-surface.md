# ADR (draft) — Always-qualified builder surface with per-facade default-namespace projection

**Status:** Draft (project-local; migrates to `docs/architecture docs/adrs/` with a final number at project close-out)
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

// SQLite facade — single-namespace target: the facade exposes the unbound namespace directly.
import { db } from './db';
await db.sql.users.select(...).build().execute(); // flat works: db.sql === sql.__unbound__
await db.orm.User.find(...);                       // db.orm === orm.__unbound__
```

The same bare name on Mongo (`db.orm.users`) works because the Mongo ORM client is keyed by **root model name**, not by namespace.

---

## Decision

### 1. The builder surface is always qualified

The SQL builder (`@prisma-next/sql-builder`) and ORM client (`@prisma-next/sql-orm-client`) expose **per-namespace facets only**:

- `Db<C>` is the namespaced-only mapped type `{ readonly [Ns in keyof C['storage']['namespaces']]: Namespace<C, Ns> }`. There is no flat by-bare-name member.
- `OrmClient<C>` is `NamespacedClientMap<C>` (`{ [Ns in keyof C['domain']['namespaces']]: OrmNamespace<C, …, Ns> }`).
- At runtime, the `sql()` / `orm()` proxies resolve namespace facets only. A non-namespace property yields `undefined` at runtime and a compile error at the type level.

Namespace selection is explicit at the builder layer. This separates **navigation** (which namespace's table/model?) from **ergonomics** (don't make me type the namespace when there's only one): the former is a builder concern, the latter a facade concern.

`UnboundTables<C>` and `TableNamesAcrossNamespaces<C>` (in `sql-builder`'s `types/db.ts`) name **"the set of tables across all namespaces"**. They are load-bearing generic constraints for `TableProxy`, `TableProxyImpl`, and the `query-builder` package (`Ref`, `Root`, `SelectBuilder`, `selection.ts`) — independent of the namespace facets, and not part of the qualified surface itself.

### 2. The facade projects its own default-namespace shape — statically, per facade

Each orchestration facade returns the right ergonomic surface for **its** target, decided statically by the facade itself:

| Facade | Target shape | `db.sql` / `db.orm` |
|---|---|---|
| Postgres (`@prisma-next/postgres`) | multi-namespace | the qualified builder outputs: `db.sql = sql`, `db.orm = orm`. Call sites qualify (`db.sql.public.users`); flat is a compile error. |
| SQLite (`@prisma-next/sqlite`) | single-namespace | the unbound namespace directly: `db.sql = sql[UNBOUND_NAMESPACE_ID]`, `db.orm = orm[UNBOUND_NAMESPACE_ID]`. Flat `db.sql.users` / `db.orm.User` work. |

The same applies to the transaction context (`tx.sql` / `tx.orm`) and the Postgres `prepare(...)` callback's `sql` parameter — each re-typed to the facade's projected shape.

A facade knows its own target at authoring time, so it states its shape directly: the SQLite facade names `UNBOUND_NAMESPACE_ID` (from `@prisma-next/framework-components/ir`); the Postgres facade returns the qualified outputs. There is **no shared projection helper and no runtime descriptor read** — and there cannot be a descriptor-driven one. The only discriminator, `defaultNamespaceId`, is a control-plane fact owned by the target descriptor and consumed at authoring time (ADR 223); the runtime target descriptor deliberately omits it (TML-2766 keeps the runtime closure to `kind/familyId/targetId/id/version/capabilities`), and the emitted `contract.json` does not carry it. A facade therefore has nothing to read at runtime, and `TargetPackRef.defaultNamespaceId` is typed `string`, so it cannot drive a type-level conditional either. Encoding the shape statically in the facade — which is the one place that already knows its target — is both the simplest and the only non-substrate-invasive expression of "unbound ↔ flat / non-unbound ↔ qualified".

### 3. Mongo is root-keyed — already flat

The Mongo ORM/query surfaces are keyed by root model name, not by namespace:

- `MongoOrmClient<TContract>` is keyed by `TContract['roots']` (root **model** names: `db.orm.users`, `db.orm.tasks`). It is a flat model-collection map.
- `mongoQuery(...)`'s output (`db.query`) is a **method API** (`{ from(rootName), rawCommand(cmd) }`), not a property map.
- Mongo is single-namespace (`__unbound__`); its roots already carry their `{ namespace, model }` coordinate, so there is no multi-namespace ambiguity to resolve.

The Mongo facade delivers flat `db.orm.<Model>` directly — the desired end-state for a single-namespace target — with no projection layer.

### 4. `Db<C>` per-namespace facet construction

The namespaced surface is a **two-level proxy** over the existing table/model accessors — thin, with no parallel resolution pipeline:

- **Types.** `Namespace<C, NsId> = { readonly [Name in keyof C['storage']['namespaces'][NsId]['entries']['table'] & string]: TableProxy<C, Name> }` is one namespace's tables keyed by bare table name. `Db<C>` maps it over every storage namespace id. The ORM mirror is `OrmNamespace<C, Collections, NsId>` (one domain namespace's models keyed by bare model name), mapped by `NamespacedClientMap<C>` over every domain namespace id.
- **Runtime.** The outer proxy's `get(prop)` checks `Object.hasOwn(storage.namespaces, prop)` (resp. `domain.namespaces`); on a hit it returns an inner facet proxy whose `get(name)` resolves the table/model **within that namespace coordinate** (`resolveTableInNamespace(storage, namespaceId, name)`; the ORM facet builds its collection at `namespaceId`). The coordinate is threaded into the existing `TableProxyImpl` / `Collection`, so qualified SQL emission and namespace-aware ORM execution reuse the TML-2605 machinery.

Indexing a *generic* `Db<TContract>` value (e.g. inside a facade generic over `TContract`) widens the namespace key to `string`, so the SQLite facade bridges the generic builder value to its literal-keyed facet type with a single narrowed cast (the unbound namespace always exists on a SQLite contract). For concrete contracts (the common case) the facet index is exact and needs no cast.

### 5. Wiring sites and prerequisite

- **Prerequisite:** [TML-2605 / ADR 223](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) — runtime identifier-qualification. The per-namespace facets call into that machinery parameterised by namespace coordinate.
- **Builder:** `packages/2-sql/4-lanes/sql-builder` (`types/db.ts`, `runtime/sql.ts`, `runtime/resolve-table.ts`); `packages/3-extensions/sql-orm-client` (`src/orm.ts`).
- **Facade projection:** `packages/3-extensions/postgres/src/runtime/postgres.ts` (qualified passthrough), `packages/3-extensions/sqlite/src/runtime/sqlite.ts` (`__unbound__` facet). The Mongo facade (`packages/3-extensions/mongo/src/runtime/mongo.ts`) is root-keyed and needs no projection.

---

## Context

ADR 223 made a target's default namespace a static descriptor fact consumed at authoring time, and deferred multi-namespace flat access and bare-name collision ergonomics to [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — this project.

The builder layer is uniformly qualified so that navigation and ergonomics do not conflate: a single qualified surface keeps the same shape across targets that have namespaces and targets that don't, and ergonomic flat access becomes a facade responsibility — composable with the facade's other concerns (session binding, multi-tenant scoping) without distorting the builder's type construction.

---

## Consequences

- **Positive:** Navigation and ergonomics are cleanly separated. The builder layer has one shape (qualified); ergonomic defaults live where they compose (the facade). Multi-namespace contracts are fully reachable (`sql.<ns>.<table>`, `orm.<ns>.<Model>`), including the same bare name in two namespaces.
- **Positive:** Single-namespace facade users (SQLite, Mongo) write flat `db.sql.<table>` / `db.orm.<Model>`.
- **Positive:** No `framework-components` substrate change and no runtime-bundle regression — the facade projection adds zero descriptor plumbing, consistent with TML-2766.
- **Breaking change (deliberate):** Consumers calling `orm.<Model>` / `sql.<table>` directly on the builder outputs, or `db.sql.<table>` / `db.orm.<Model>` on a **multi-namespace (Postgres)** facade, must qualify (`sql.public.<table>`, `orm.public.<Model>`, `db.sql.public.<table>`, …). Recorded as a user upgrade-instructions entry (`qualify-flat-builder-accessors`, 0.12 → 0.13).
- **Unknown access returns `undefined`.** The `sql()` / `orm()` proxy `get` traps return `undefined` for an unknown namespace, table, or model rather than throwing — throwing inside a `Proxy` trap breaks ordinary JS property probing (`then`/`toJSON`/`constructor` checks done by frameworks and serializers on whatever value flows past). The always-qualified contract is enforced at the **type level** (unknown access is a compile error); the runtime stays permissive.
- **Trade-off:** A facade generic over `TContract` needs one narrowed cast to bridge the generic-index widening to its literal-keyed facet type. Concrete-contract consumers are unaffected.

---

## References

- [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- Linear: [TML-2550](https://linear.app/prisma-company/issue/TML-2550) (this project), [TML-2605](https://linear.app/prisma-company/issue/TML-2605) (prerequisite), TML-2766 (runtime-descriptor minimisation)
