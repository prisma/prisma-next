# Slice: runtime-qualification

_Parent project: [`projects/target-extensible-ir-namespaces`](../../spec.md). Outcome this slice contributes: runtime SQL emits namespace-qualified identifiers and the flat DSL/ORM surface resolves through a per-family default namespace — the last in-project unit; the project closes after it merges._

## At a glance

Runtime query SQL still emits bare `"user"` even though the contract IR is now fully namespaced (`storage.namespaces.public.tables.user`). This slice makes runtime SQL emit the namespace-qualified identifier its IR coordinate already implies — Postgres `"public"."user"`, SQLite unqualified `"user"` (single namespace), Mongo's collection in the right namespace's database — and makes the flat-by-name surfaces (`db.sql.user`, `db.User`) resolve a bare name through a **per-family default namespace** (`'public'` Postgres, `'__unbound__'` Mongo/SQLite) so existing single-namespace consumers write zero query-code changes. It also retires the transitional single-namespace projection helpers the `symmetric-domain-plane` slice deliberately left behind for this slice to eliminate.

## Chosen design

**1. Namespace identity is resolved once and carried to the renderer — never re-derived by bare name at render time.**

Today the DSL proxy (`sql-builder` `findTableAcrossNamespaces`) and the ORM (`unboundTable`) already determine *which namespace* owns a bare name when they construct a `TableSource`/query plan — then discard it. The AST (`relational-core` `TableSource.name`) carries only the bare table name, so the renderer has lost the namespace by lowering time.

The fix carries the resolved namespace coordinate on the table AST node, set at proxy/accessor construction (where the resolution already happens), and the **family adapter renders qualification through the namespace concretion's `qualifyTable()`** (`PostgresSchema.qualifyTable` already exists and is used by the DDL/migration path; SQLite's `qualifyTable` is already a `"name"` no-op).

```text
proxy/accessor resolves name → namespace (default-namespace-first)
        │  carries namespaceId on the table AST node
        ▼
adapter renderer: namespace.qualifyTable(name)   → "public"."user"  (PG)
                                                  → "user"            (SQLite no-op)
```

**Rejected alternative — render-time resolution by bare name** (renderer re-looks-up `name` in `contract.storage` default-first). Smaller diff, but it re-derives what the proxy already knew and **diverges from the proxy's choice for colliding names** — `db.sql.auth.user` would render `"public"."user"` because the renderer re-resolves default-first. explicit-dsl (TML-2550) would have to rip it out. Carrying the coordinate is the seam explicit-dsl extends, not replaces.

**2. Per-family default-namespace runtime constant.** Authoring already centralises the rule (`POSTGRES_DEFAULT_NAMESPACE_ID = 'public'` in `contract-ts`; `defaultSqlNamespaceIdForTarget` in `contract-psl`). Runtime currently has no importable equivalent — `findTableAcrossNamespaces` scans namespaces in insertion order with no default preference. This slice exports a per-family/target runtime `defaultStorageNamespaceId` / `defaultDomainNamespaceId` and routes every flat-name resolution (DSL runtime lookup, ORM model/table resolution) through **default-namespace-first** ordering. No re-scattered string literals.

**3. The flat surface stays flat; the type level catches up.** `db.sql.user` / `db.User` keep working unchanged. `query-builder`'s `UnboundTables<C>` still indexes `namespaces['__unbound__']['tables']` only — which is now `never` for a Postgres `public` contract — and must be brought to parity with `sql-builder`'s cross-namespace + default-namespace types.

**4. Retire the transitional projection helpers.** `symmetric-domain-plane` (round 2) left `contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` (runtime) and `ContractModelsMap` / `ContractValueObjectsMap` (type-level) in the foundation `contract` package, marked transitional, with this slice named as their owner. Now that consumers resolve through a default namespace, the throw-on-multi-namespace projection is replaced by honest default-namespace resolution and the merge-across-namespaces type maps are removed.

## Coherence rationale

One reviewable PR: it is the single migration that takes the runtime query path from namespace-blind to namespace-aware. Every change — the default-namespace constant, the AST coordinate, the two renderers, the DSL/ORM resolution, the type-level parity, the helper retirement — is a facet of "a bare query name now resolves and renders through its namespace." Splitting it leaves a half-namespaced runtime (e.g. qualified render but flat-by-insertion-order resolution) that is observably broken for any non-`public`-first contract.

## Scope

**In:**

- Per-family/target runtime default-namespace constant(s) and a shared default-namespace-first table/model resolver.
- `relational-core` `TableSource` AST carrying a resolved namespace coordinate; `sql-builder` proxy + `sql-orm-client` query plans stamping it.
- Postgres + SQLite query renderers qualifying FROM/INSERT/UPDATE/DELETE table identifiers via the namespace concretion (`qualifyTable`). Column refs stay alias-qualified (unchanged).
- `sql-builder` runtime lookup (`findTableAcrossNamespaces`) → default-namespace-first.
- `query-builder` type-level `UnboundTables` / `root.from` parity with `sql-builder` (multi-namespace union + default-namespace resolution).
- `sql-orm-client` flat resolution (`orm.ts`, `collection-contract.ts`) through the default domain/storage namespace.
- Mongo runtime: confirm collection resolution addresses the correct namespace's database; single-namespace (`__unbound__`) is a no-op (no qualification syntax).
- Retire the transitional projection helpers (`contractModels` et al.) per the `symmetric-domain-plane` hand-off.
- Update Postgres/SQLite adapter unit-test expectations and demo integration SQL expectations to qualified identifiers; add a default-namespace resolution regression test.
- ADR for the default-namespace family-façade convention (project PDoD8 / OQ2).

**Out:**

- Explicit namespace-aware surface `db.sql.<ns>.<table>` / `db.<ns>.<Model>` — TML-2550 (elevated out), builds *on* this slice.
- Cross-namespace name-collision ergonomics (union/qualify-on-collision/compile-error) — TML-2550.
- Per-namespace `contract.d.ts` emission for multi-namespace contracts — TML-2550 co-designs it with the explicit surface; this slice keeps single-default-namespace emission.
- Storage/domain IR reshape — closed.
- Mongo multi-namespace support.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Postgres `public` contract typed through `query-builder` `UnboundTables['__unbound__']` | In scope — fix | Currently resolves to `never`; type parity is part of FR6, not a follow-up. |
| Demo integration tests assumed skipped (per stale ticket text) | Correction | They are **active** today; the observable change is the emitted SQL they assert + a new default-namespace regression — not re-enabling skips. |
| SQLite `qualifyTable` | Already a `"name"` no-op | Single-namespace; rendering through it is correct and changes nothing observable. |

## Slice-specific done conditions

- [ ] Demo's emitted Postgres query SQL contains `"public"."user"` (and friends); `examples/prisma-next-demo/src/queries/*` compile and run **unchanged** (PDoD6).
- [ ] A regression test pins `db.sql.user` / `db.User` resolving to the default namespace's table with no explicit namespace argument.
- [ ] No `contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` / `ContractModelsMap` / `ContractValueObjectsMap` transitional surface remains in the foundation `contract` package; `lint:deps` clean.
- [ ] `pnpm fixtures:check` clean; upgrade instructions recorded if `examples/` or `packages/3-extensions/` *source* changed.

## Open Questions

1. **Carry the namespace coordinate on the AST (chosen) vs. render-time by-name resolution.** Working position: **carry it on the AST** — render-time-by-name is torn out by explicit-dsl and renders the wrong schema for colliding names. Flagged for operator visibility because it sizes the diff (touches `relational-core` AST + all `TableSource.named` call sites) larger than a renderer-only change.
2. **Does the slice produce the default-namespace-convention ADR, or fold it into ADR 221?** Working position: a **new short ADR** — "family façade owns its default namespace" is a convention future families inherit, distinct from ADR 221's IR-shape decisions.

## References

- Parent project: [`projects/target-extensible-ir-namespaces/spec.md`](../../spec.md) (FR5, FR6, PDoD5–PDoD7)
- Sibling slice hand-off: [`../symmetric-domain-plane/spec.md`](../symmetric-domain-plane/spec.md) § "Round 2 / Transitional surface that deliberately stays"
- Linear: [TML-2605](https://linear.app/prisma-company/issue/TML-2605)
- [ADR 221](../../../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
