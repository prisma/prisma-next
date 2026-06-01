# ADR 223 — Default namespace family façade convention

**Status:** Accepted
**Date:** 2026-06-01
**Linear:** TML-2605

---

## A concrete example

A Postgres contract declares models under `domain.namespaces.public` and tables under `storage.namespaces.public`. Application code keeps the flat surface:

```ts
const rows = await db.sql.user.findMany();
```

At runtime the ORM and SQL builder resolve the bare name `user` **default-namespace-first** (`public` for Postgres), stamp the resolved storage namespace on the table AST node, and the Postgres adapter renders:

```sql
FROM "public"."user"
```

The same bare name on SQLite or Mongo resolves through that family's default (`__unbound__`); SQLite's `qualifyTable` remains a no-op (`"user"`), and Mongo addresses the collection in the late-bound namespace's database without SQL-style qualification.

---

## Decision

Each database **family** (and, where targets diverge within a family, each **target**) owns a single **runtime default namespace id** for flat-name resolution on both planes:

| Family / target | Default domain namespace | Default storage namespace |
|---|---|---|
| Postgres (SQL) | `public` | `public` |
| SQLite (SQL) | `__unbound__` | `__unbound__` |
| Mongo | `__unbound__` | `__unbound__` |

The flat DSL/ORM surface (`db.sql.user`, `db.User`, and equivalent collection accessors) resolves a bare entity name through that default **first**, then falls back to the family's inference rules when the default slot is absent (for example a sole namespace on an extension contract). Runtime code imports the constants and helpers from `@prisma-next/contract` (`defaultDomainNamespaceIdForSqlTarget`, `defaultDomainNamespaceIdForMongo`, `domainModelsAtDefaultNamespace`, `domainValueObjectsAtDefaultNamespace`) rather than re-scattering string literals.

**SQL qualification** is not re-derived at render time by bare table name. Once the proxy or accessor has chosen a namespace, the coordinate is carried on the relational AST; the family adapter renders identifiers via the namespace concretion's `qualifyTable(tableName)` (Postgres → `"schema"."table"`; SQLite unbound → `"table"`). Column references in SELECT lists remain alias-qualified as before.

**Runtime vs emitter split:**

- **Runtime** resolves default-namespace-first and **does not throw** when a contract declares multiple domain or storage namespaces. Multi-namespace contracts remain executable; only the default namespace backs the flat surface until explicit per-namespace APIs land ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)).
- **Contract emission** keeps a **fail-loud** single-namespace guard (`assertSingleDomainNamespaceForEmission`) because per-namespace `contract.d.ts` slices are not emitted yet. Extension authors with multiple namespaces must target explicit namespace paths in hand-authored types until TML-2550 co-designs per-namespace emission with the explicit DSL surface.

Transitional projection helpers (`contractModels`, `contractValueObjects`, `resolveSingleDomainNamespaceId`, `ContractModelsMap`, `ContractValueObjectsMap`) are removed from the foundation `contract` package; consumers use default-namespace access helpers and `ContractModelDefinitions<Contract>` for typed model shapes.

---

## Context

[ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) established namespaced `domain` and `storage` planes with uniform entity coordinates. Authoring already centralised Postgres's default as `public` in contract-ts/PSL. Runtime query SQL nevertheless continued to emit bare `"user"` because the relational AST dropped namespace identity after proxy resolution, and flat-name lookup scanned namespaces in insertion order.

The symmetric-domain-plane work moved models under `contract.domain.namespaces` but left throw-on-multi-namespace projection helpers as a deliberate bridge. Runtime qualification completes the bridge: honest default-namespace resolution at runtime, namespace-qualified SQL where the target requires it, and retirement of the transitional helpers.

---

## Consequences

- **Positive:** Single-namespace Postgres consumers need no query-code changes; emitted SQL matches database schema qualification; the AST coordinate is the extension point for explicit per-namespace DSL ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)) without another render-time rewrite.
- **Positive:** Family defaults live in one importable surface per target, aligned with authoring constants.
- **Trade-off:** Multi-namespace contracts at runtime use the default namespace for flat names only; cross-namespace collisions on the flat surface are not diagnosed until explicit APIs ship.
- **Trade-off:** Emitter still rejects multi-namespace contracts for typed emission; runtime and emitter behaviour intentionally diverge until per-namespace `contract.d.ts` exists.

---

## References

- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- Linear: [TML-2605](https://linear.app/prisma-company/issue/TML-2605), [TML-2550](https://linear.app/prisma-company/issue/TML-2550)
