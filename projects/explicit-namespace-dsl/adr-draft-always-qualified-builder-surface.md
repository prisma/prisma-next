# ADR (draft) — Always-qualified builder surface with per-facade default-namespace projection

**Status:** Draft
**Date:** 2026-06-09
**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550)
**Builds on:** [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) (TML-2605)

---

## Context

ADR 223 made a target's default namespace a static descriptor fact and deferred multi-namespace flat access and bare-name collision ergonomics. Two questions had to be decided: how a contract on a target that supports multiple namespaces is navigated, and how a target that supports a single namespace keeps flat ergonomics. Throughout, whether namespaces are in play is a property of the **target**, not of the contract.

---

## Decision

### 1. The builder surface is always qualified

The SQL builder and ORM client require the namespace at the call site (`sql.<ns>.<table>`, `orm.<ns>.<Model>`); there is no flat by-bare-name access at the builder layer.

```ts
await sql.auth.users.select({ id: true }).build().execute();
await orm.public.Profile.find({ where: { id } });
```

This separates **navigation** (which namespace's table/model?) from **ergonomics** (don't make me type the namespace when there's only one): navigation is a builder concern, ergonomics a facade concern.

### 2. Whether call sites must qualify is decided by the target, not the contract

Each facade projects its surface by whether its **target** supports more than one namespace — independently of how many namespaces a given contract actually declares:

- A target that supports multiple namespaces (Postgres) exposes the qualified surface. Call sites name the namespace (`db.sql.public.users`) **even when the contract declares only a single namespace**.
- A target that supports a single namespace (SQLite, Mongo) exposes that namespace's tables and models directly, so access is flat (`db.sql.users`).

A target declares which it is through its descriptor's default namespace: the unbound sentinel marks a single-namespace target; any concrete default (e.g. Postgres's `public`) marks a multi-namespace one. Each facade knows its own target, so it states the right shape directly. There is **no shared, descriptor-driven projection**, and there cannot be one: the discriminator is an authoring-time fact, deliberately absent from the runtime descriptor and the emitted contract (TML-2766), so a facade cannot read it at runtime.

### 3. Mongo needs no projection

The Mongo ORM is keyed by model name, not by namespace, and is already flat — there is no flat-vs-qualified distinction to project.

### 4. Unknown access returns `undefined`, not a throw

Accessing an unknown namespace, table, or model yields `undefined` at runtime; the always-qualified contract is enforced at the **type level** (unknown access is a compile error). Throwing on property access would break ordinary JS probing (e.g. `then` / `toJSON` checks by frameworks and serializers).

---

## Consequences

- **Breaking change (deliberate):** consumers of a target that supports multiple namespaces (Postgres) must qualify bare-name access with the namespace — including contracts that declare only one namespace. Recorded as the `qualify-flat-builder-accessors` upgrade entry (0.12 → 0.13).
- Consumers of a single-namespace target (SQLite, Mongo) write flat `db.sql.<table>` / `db.orm.<Model>` with no change.
- The facade adds no descriptor plumbing, consistent with TML-2766's minimal runtime descriptor.

---

## References

- [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- Linear: [TML-2550](https://linear.app/prisma-company/issue/TML-2550), [TML-2605](https://linear.app/prisma-company/issue/TML-2605) (runtime identifier-qualification), TML-2766 (runtime-descriptor minimisation)
