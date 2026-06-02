# Slice: runtime-qualification

_Parent project: [`projects/target-extensible-ir-namespaces`](../../spec.md). Outcome this slice contributes: runtime SQL emits namespace-qualified identifiers and the flat DSL/ORM surface resolves through a per-family default namespace — the last in-project unit; the project closes after it merges._

## At a glance

Runtime query SQL still emits bare `"user"` even though the contract IR is now fully namespaced (`storage.namespaces.public.tables.user`). This slice makes runtime SQL emit the namespace-qualified identifier its IR coordinate already implies — Postgres `"public"."user"`, SQLite unqualified `"user"` (single namespace), Mongo's collection in the right namespace's database — and makes the flat-by-name surfaces (`db.sql.user`, `db.User`) resolve a bare name through its **target's default namespace** (`'public'` Postgres, `'__unbound__'` Mongo/SQLite) so existing single-namespace consumers write zero query-code changes. It also retires the transitional single-namespace projection helpers the `symmetric-domain-plane` slice deliberately left behind for this slice to eliminate.

## Current state & remaining rework

> Verified against the branch at HEAD `d9e8b1e1d` (the work on PR #670). Read this before the design sections below: most of the behaviour already landed; one load-bearing **ownership** decision is being corrected.

The slice's runtime qualification, the AST coordinate, the qualifying renderers, the query-builder type parity, and the transitional-helper retirement all **landed** across the dispatches on PR #670. Review of that PR found one architectural defect: the per-target default namespace was implemented as **framework-owned constants that name a target** (`POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, `defaultStorageNamespaceIdForSqlTarget`, all branching on `targetId === 'postgres'` inside target-agnostic packages). That violates layer purity. The corrected design (§2 below) makes the default namespace **static data owned by the target**, consumed only by authoring.

| Design facet | Status | Evidence |
|---|---|---|
| §1 — namespace coordinate carried on the AST + qualified rendering | **Landed** | `TableSource.namespaceId` + `TableSource.named(name, alias?, namespaceId?)`; Postgres/SQLite renderers render via `namespace.qualifyTable`; `PostgresSchema.qualifyTable` emits `"public"."user"`. |
| §2 — default-namespace **ownership** | **Rework (R1–R2)** | R1 (landed, uncommitted): `defaultNamespaceId` on `TargetPackRef` + the three real descriptors; `build-contract.ts` consumes `definition.target.defaultNamespaceId`; the `targetId === 'postgres'` branch in authoring is gone. R2 (remaining): delete the framework + SQL/Mongo-family default-namespace helpers; make the runtime resolvers' `defaultNamespaceId` optional (scan when absent). |
| §3 — query-builder type parity | **Landed** | `query-builder`'s `UnboundTables` at parity with `sql-builder`'s. |
| §4a — transitional projection-helper retirement | **Landed** | `contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` / `ContractModelsMap` / `ContractValueObjectsMap` removed (grep-clean in `packages/`). |
| §4b — contract-walking ergonomics | **Rework (R3)** | `ContractView.tsx` still calls `domainModelsAtDefaultNamespace(contract.domain, defaultDomainNamespaceIdForSqlTarget(contract.target)) as Models`; the emitted `Models` is an inline `infer` conditional, not a direct `ContractModelDefinitions<Contract>` alias. |
| ADR | **Rework (R4)** | ADR 223 records the rejected framework-façade convention; it must be amended to the target-owned design. |

The remaining work is the **R1–R4 rework** sequenced in [`plan.md`](./plan.md). The design below describes the corrected end state.

## Chosen design

**1. Namespace identity is resolved once and carried to the renderer — never re-derived by bare name at render time.**

The DSL proxy (`sql-builder`'s `resolveTableForFlatName`) and the ORM (`sql-orm-client`'s `storage-resolution`) determine *which namespace* owns a bare name when they construct a `TableSource`/query plan. The AST (`relational-core` `TableSource`) now carries that resolved namespace coordinate (`namespaceId`) so the renderer no longer has to re-derive it at lowering time.

The fix carries the resolved namespace coordinate on the table AST node, set at proxy/accessor construction (where the resolution already happens), and the **family adapter renders qualification through the namespace concretion's `qualifyTable()`** (`PostgresSchema.qualifyTable` already exists and is used by the DDL/migration path; SQLite's `qualifyTable` is already a `"name"` no-op).

```text
proxy/accessor resolves name → namespace (default-namespace-first)
        │  carries namespaceId on the table AST node
        ▼
adapter renderer: namespace.qualifyTable(name)   → "public"."user"  (PG)
                                                  → "user"            (SQLite no-op)
```

**Rejected alternative — render-time resolution by bare name** (renderer re-looks-up `name` in `contract.storage` default-first). Smaller diff, but it re-derives what the proxy already knew and **diverges from the proxy's choice for colliding names** — `db.sql.auth.user` would render `"public"."user"` because the renderer re-resolves default-first. explicit-dsl (TML-2550) would have to rip it out. Carrying the coordinate is the seam explicit-dsl extends, not replaces.

**2. The default namespace is static data owned by the target — not the framework.** Each target declares its default namespace once, on its descriptor: `defaultNamespaceId` (`'public'` for Postgres; the unbound sentinel `'__unbound__'` for SQLite and Mongo). **Authoring is the sole consumer** — `build-contract.ts` reads `definition.target.defaultNamespaceId` to stamp a bare model/table's namespace coordinate. **No framework code names a target, and no `targetId === 'postgres'` branch exists anywhere.**

At **runtime** the contract carries the target only as an id *string* (`contract.target`), not the descriptor object — and runtime needs no per-target default. `defaultNamespaceId` is an authoring-time *placement* fact; once authoring has lowered the contract every model/table already sits in an explicit namespace, so a bare name resolves to "the contract's one namespace". The sole-namespace helpers (`domainModelsAtDefaultNamespace` / `domainValueObjectsAtDefaultNamespace`) read that namespace via `soleDomainNamespaceId`, which **throws** on a zero- or multi-namespace contract rather than guessing. The bare-name resolvers (`resolveStorageTable` / `resolveDomainModel`) scan for the named entity and are exact for the single-namespace contracts in scope. Explicit cross-namespace selection and bare-name collision ergonomics — the only cases where a stored default would change the answer — are TML-2550 (which selects explicitly, not by default).

This is the corrective design. The original PR #670 instead exported framework-level `defaultDomainNamespaceIdForSqlTarget` / `defaultStorageNamespaceIdForSqlTarget` constants that branched on `targetId === 'postgres'` inside target-agnostic packages — a layer-purity violation. The rework relocates the *one* fact a target owns (its default namespace) onto the target descriptor and lets authoring read it polymorphically; runtime needs no per-target default at all for this slice.

**3. The flat surface stays flat; the type level is at parity (landed).** `db.sql.user` / `db.User` keep working unchanged. `query-builder`'s `UnboundTables<C>` originally indexed `namespaces['__unbound__']['tables']` only — `never` for a Postgres `public` contract — and was brought to parity with `sql-builder`'s cross-namespace + default-namespace types.

**4. Retire the transitional projection helpers.** `symmetric-domain-plane` (round 2) left `contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` (runtime) and `ContractModelsMap` / `ContractValueObjectsMap` (type-level) in the foundation `contract` package, marked transitional, with this slice named as their owner. Now that consumers resolve through the contract's sole namespace, the transitional projection is replaced by fail-loud sole-namespace resolution (`soleDomainNamespaceId` throws on a multi-namespace contract) and the merge-across-namespaces type maps are removed.

## Coherence rationale

One reviewable PR: it is the single migration that takes the runtime query path from namespace-blind to namespace-aware. Every change — the default-namespace constant, the AST coordinate, the two renderers, the DSL/ORM resolution, the type-level parity, the helper retirement — is a facet of "a bare query name now resolves and renders through its namespace." Splitting it leaves a half-namespaced runtime (e.g. qualified render but flat-by-insertion-order resolution) that is observably broken for any non-`public`-first contract.

## Scope

**In:**

- Target-owned `defaultNamespaceId` on the target descriptor, consumed by authoring (`build-contract.ts`); the framework + SQL/Mongo-family default-namespace helpers deleted.
- A shared table/model resolver (`resolveStorageTable` / `resolveDomainModel`) that scans the contract's namespaces target-agnostically; the sole-namespace helpers fail loud (`soleDomainNamespaceId`) on a multi-namespace contract rather than guessing.
- `relational-core` `TableSource` AST carrying a resolved namespace coordinate; `sql-builder` proxy + `sql-orm-client` query plans stamping it.
- Postgres + SQLite query renderers qualifying FROM/INSERT/UPDATE/DELETE table identifiers via the namespace concretion (`qualifyTable`). Column refs stay alias-qualified (unchanged).
- `sql-builder` / `sql-orm-client` runtime flat-name resolution through the shared resolver (no per-target default read at runtime).
- `query-builder` type-level `UnboundTables` / `root.from` parity with `sql-builder` (multi-namespace union + default-namespace resolution).
- `sql-orm-client` flat resolution (`orm.ts`, `collection-contract.ts`) through the default domain/storage namespace.
- Mongo runtime: confirm collection resolution addresses the correct namespace's database; single-namespace (`__unbound__`) is a no-op (no qualification syntax).
- Retire the transitional projection helpers (`contractModels` et al.) per the `symmetric-domain-plane` hand-off.
- Update Postgres/SQLite adapter unit-test expectations and demo integration SQL expectations to qualified identifiers; add a default-namespace resolution regression test.
- ADR 223 amended to record the **target-owned default-namespace** convention (descriptor `defaultNamespaceId`, authoring-only consumer).

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
- [ ] No framework or family package names a target for its default namespace: `POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, `defaultDomainNamespaceIdForMongo`, `defaultStorageNamespaceIdForSqlTarget` (and `targetId === 'postgres'` default-namespace branches) are gone; the target descriptor's `defaultNamespaceId` is the only source, read by authoring.
- [ ] Contract-walking is a direct, target-agnostic read: the emitted `Models` is a direct `ContractModelDefinitions<Contract>` alias, and `ContractView.tsx` walks models with no `defaultDomainNamespaceIdForSqlTarget(...)` argument and no `as Models` cast.
- [ ] `pnpm fixtures:check` clean; upgrade instructions recorded if `examples/` or `packages/3-extensions/` *source* changed.

## Resolved decisions

1. **Carry the namespace coordinate on the AST vs. render-time by-name resolution.** Resolved: **carry it on the AST** (landed — `TableSource.namespaceId`). Render-time-by-name would be torn out by TML-2550 and renders the wrong schema for colliding names.
2. **Where does the default namespace live?** Resolved: **on the target descriptor** (`defaultNamespaceId`), consumed by authoring only. The PR #670 implementation that put target-naming constants in framework/family packages is being reworked out (R1–R2). Runtime needs no per-target default for this slice's single-default-namespace scope (it scans).
3. **A new ADR vs. folding into ADR 221?** Resolved: **a separate ADR (223)** — the default-namespace ownership convention is distinct from ADR 221's IR-shape decisions. R4 amends ADR 223 from the rejected framework-façade framing to the target-owned framing.
4. **Multi-namespace bare-name collision ordering** (operator call): dropping a "prefer `public`" bias means a multi-namespace contract with a bare name colliding across namespaces resolves by insertion order. Accepted — resolved by the explicit-namespace DSL work (TML-2550), which introduces fully-qualified namespaced access to the query builder and ORM.

## References

- Parent project: [`projects/target-extensible-ir-namespaces/spec.md`](../../spec.md) (FR5, FR6, PDoD5–PDoD7)
- Sibling slice hand-off: [`../symmetric-domain-plane/spec.md`](../symmetric-domain-plane/spec.md) § "Round 2 / Transitional surface that deliberately stays"
- Linear: [TML-2605](https://linear.app/prisma-company/issue/TML-2605)
- [ADR 221](../../../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
