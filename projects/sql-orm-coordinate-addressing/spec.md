# Project: sql-orm-client coordinate addressing (un-pin from the default namespace)

Linear: [TML-2841](https://linear.app/prisma-company/issue/TML-2841) (origin ticket → slice 1; sibling slice tickets linked from `plan.md`).

## Purpose

Migrate `packages/3-extensions/sql-orm-client` off its module-wide single-namespace assumption and
onto the ADR 221 canonical entity coordinate, so the ORM can serve **multi-namespace contracts** —
including polymorphic bases whose variants live in another namespace (the wmadden review finding
that spawned TML-2841), relations whose targets live in another namespace, and contracts where bare
entity names collide across namespaces.

Since TML-2816 landed (PRs #720/#778, merged 2026-06-09), the module's surface and caches are
namespace-scoped: `modelsOf(contract, namespaceId)`, coordinate-keyed metadata caches, collections
that carry their namespace, and relation/include resolution that honors `rel.to.namespace`. What
remains namespace-flat is the **polymorphism layer**: variants are resolved only inside the base's
namespace (`resolvePolymorphismInfo`, `collection-contract.ts:116` — a cross-namespace variant
throws "missing from the contract"); `PolymorphismInfo.baseTable`,
`PolymorphismVariantInfo.table`, and `VariantColumnRef.table` carry bare table strings that
downstream binds in the *base's* namespace (`buildMtiJoins`, `query-plan-select.ts:1295`); the
merged row-map aliases are bare `variant_table__column` (`collection-runtime.ts:90`). One
front-door remnant survives: `orm.ts:167` (`createCollectionRegistry`) still calls
`domainModelsAtDefaultNamespace`, so custom collections on a multi-namespace contract throw.

## Place in the world

- **ADR 221** defines the coordinate `(plane, namespaceId, entityKind, entityName)`; the blessed
  lookups already exist and return coordinates: `resolveDomainModel(domain, name)` →
  `{namespaceId, model}` (`framework/0-foundation/contract/src/resolve-domain-model.ts:15`) and
  `resolveStorageTable(storage, name)` → `{namespaceId, table}`
  (`2-sql/1-core/contract/src/resolve-storage-table.ts:32`).
- **TML-2816 (explicit-namespace-dsl, PRs #720/#778)** delivered the always-qualified surface
  (`orm.<ns>.<Model>`, per-facade `db` projection), the namespace-scoped
  `modelsOf(contract, namespaceId)`/`modelOf` lookups, coordinate-keyed caches, collection
  namespace context, relation/include namespace threading (`toNamespace`/`relatedNamespaceId`
  through the include builders, decode path, and M:N junction), and an end-to-end PGlite
  multi-namespace fixture (`namespaced-accessors-e2e.integration.test.ts`) with same-bare-name
  collisions and a cross-namespace FK. This project consumes those shapes rather than inventing
  threading.
- The **contract IR already carries what we need** (post TML-2751/2807/2808): domain cross-refs are
  `{namespace, model}` objects (incl. variant `base`), storage tables live under
  `namespaces.<ns>.entries.table`, and the MTI synthetic FK carries `references.namespaceId`.
  One nuance: the base's forward `variants` map is bare-name-keyed
  (`ContractVariantEntry = { value }`); only the variant's `base` backref is qualified — so
  cross-namespace variant resolution goes through `resolveDomainModel`'s cross-namespace search
  (unique-names constraint) or backref-driven discovery.
- The ORM's own `TableSource` path is namespace-aware (`tableSourceForContract` /
  `requireStorageTableForContract`, `storage-resolution.ts:19,57`); post-TML-2816 every consumer
  feeds it the right coordinate **except the poly layer**, which binds variant tables in the
  base's namespace.
- **Authoring can already express cross-namespace variants** (the interpreter resolves a variant's
  base namespace via `modelNamespaceIds`, `interpreter.ts:1731,1810`) provided model names are
  unique across namespaces — a viable end-to-end test vehicle exists without interpreter changes.

## Non-goals

- **Interpreter/emitter coordinate completion** beyond what tests force: the PSL materializers'
  bare `nodeByModel` lookups (collide on duplicate names across namespaces) are authoring-side debt;
  ticket separately if a slice trips on it.
- **Duplicate-bare-name UX/diagnostics** (explicit namespace selection ergonomics, per TML-2550
  lineage): slices must be *correct* under collisions (no silent wrong-table), but rich diagnostics
  are follow-up.
- TML-2783 (select vs variant columns), TML-2782 (orderBy MTI columns), TML-2824 (TS authoring
  surface) — orthogonal known issues; do not fold in.
- Mongo / document ORM.

## Cross-cutting requirements (every slice)

- Entities resolve via the ADR 221 helpers (`resolveDomainModel` / `resolveStorageTable`) or carry
  `{namespace, name}` object refs — no NEW bare-name lookups; each slice retires the bare paths it
  touches. `domainModelsAtDefaultNamespace` usage must be GONE by project end (the
  namespace-scoped `modelsOf(contract, namespaceId)` is post-TML-2816 plumbing and stays).
- Caches keyed by coordinate (namespace-qualified), never bare `modelName`.
- Behavior on today's single-namespace contracts is byte-for-byte unchanged (regression gate: the
  existing sql-orm-client suite + the poly integration fixtures pass untouched, except where a test
  asserted a loud failure this project retires — e.g. the cross-namespace variant throw or the
  custom-collection registry throw).
- Each slice lands a **multi-namespace test vehicle** for its surface (emitted fixture with ≥2
  namespaces; unique model names — collision-correctness asserted at the unit level).
- Repo conventions: tests-first; whole-shape `toEqual` + varargs `select` rule; no bare `as`
  (`blindCast`/`castAs`); DCO; fail-fast over fabrication.

## Transitional-shape constraints

- Slice 1 (poly layer) sets the **template types** (`{namespace, table}` object refs on
  `PolymorphismInfo`/`PolymorphismVariantInfo`/`VariantColumnRef`, coordinate cache keys); later
  slices conform to it rather than inventing parallel shapes.
- Until the final slice, parts of the module remain pinned — acceptable; loud failure may only be
  retired once resolution is actually correct (a half-migrated module silently mis-resolving is
  worse than one that throws). Concretely: the cross-namespace variant throw in
  `resolvePolymorphismInfo` falls only when S1 makes variant resolution correct, and the
  `createCollectionRegistry` defaulting remnant falls in the final slice.

## Project DoD

- A multi-namespace contract (≥2 namespaces, poly base with a variant in another namespace,
  relation crossing namespaces) is served correctly end-to-end by the ORM: reads, `.include()`
  (incl. polymorphic targets), `.variant()` narrowing, variant-aware predicates, mutations.
- `domainModelsAtDefaultNamespace` is gone from `sql-orm-client` (incl. the `orm.ts`
  custom-collection registry remnant).
- No bare-name table/model lookup remains in the module (grep gate recorded in the final slice).
- Integration coverage on PGlite for the multi-namespace fixture; unit coverage for cross-namespace
  collision correctness.
- Follow-ups (interpreter materializer lookups, diagnostics UX) filed if surfaced, not silently
  absorbed.
