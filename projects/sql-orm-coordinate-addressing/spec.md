# Project: sql-orm-client coordinate addressing (un-pin from the default namespace)

Linear: [TML-2841](https://linear.app/prisma-company/issue/TML-2841) (origin ticket → slice 1; sibling slice tickets linked from `plan.md`).

## Purpose

Migrate `packages/3-extensions/sql-orm-client` off its module-wide single-namespace assumption and
onto the ADR 221 canonical entity coordinate, so the ORM can serve **multi-namespace contracts** —
including polymorphic bases whose variants live in another namespace (the wmadden review finding
that spawned TML-2841), relations whose targets live in another namespace, and contracts where bare
entity names collide across namespaces.

Today the module is **default-namespace-pinned at the front door**: `modelsOf()` →
`domainModelsAtDefaultNamespace()` **throws on any contract with more than one namespace**
(`domain-namespace-access.ts:11-22`). Everything downstream — `PolymorphismInfo.baseTable`,
`PolymorphismVariantInfo.table`, `VariantColumnRef.table`, relation resolution
(`rel.to.namespace` ignored at `collection-contract.ts:330`), the field/column caches keyed on bare
`modelName`, `variant_table__column` aliases — addresses entities by bare name.

## Place in the world

- **ADR 221** defines the coordinate `(plane, namespaceId, entityKind, entityName)`; the blessed
  lookups already exist and return coordinates: `resolveDomainModel(domain, name)` →
  `{namespaceId, model}` (`framework/0-foundation/contract/src/resolve-domain-model.ts:15`) and
  `resolveStorageTable(storage, name)` → `{namespaceId, table}`
  (`2-sql/1-core/contract/src/resolve-storage-table.ts:29`).
- The **contract IR already carries what we need** (post TML-2751/2807/2808): domain cross-refs are
  `{namespace, model}` objects (incl. variant `base`), storage tables live under
  `namespaces.<ns>.entries.table`, and the MTI synthetic FK carries `references.namespaceId`.
- The ORM's own `TableSource` path is already namespace-aware (`tableSourceForContract` /
  `requireStorageTableForContract`, `storage-resolution.ts:22,57`); the module just never feeds it
  non-default coordinates.
- **Authoring can already express cross-namespace variants** (interpreter emits `base` with the
  base's namespace, `interpreter.ts:1454-1457`) provided model names are unique across namespaces —
  a viable end-to-end test vehicle exists without interpreter changes.

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
  touches. `modelsOf()`/`domainModelsAtDefaultNamespace` usage must be GONE by project end.
- Caches keyed by coordinate (namespace-qualified), never bare `modelName`.
- Behavior on today's single-namespace contracts is byte-for-byte unchanged (regression gate: the
  existing sql-orm-client suite + the poly integration fixtures pass untouched, except where a test
  asserted the throwing front door).
- Each slice lands a **multi-namespace test vehicle** for its surface (emitted fixture with ≥2
  namespaces; unique model names — collision-correctness asserted at the unit level).
- Repo conventions: tests-first; whole-shape `toEqual` + varargs `select` rule; no bare `as`
  (`blindCast`/`castAs`); DCO; fail-fast over fabrication.

## Transitional-shape constraints

- Slice 1 (poly layer) sets the **template types** (`{namespace, table}` object refs on
  `PolymorphismInfo`/`PolymorphismVariantInfo`/`VariantColumnRef`, coordinate cache keys); later
  slices conform to it rather than inventing parallel shapes.
- Until the final slice, parts of the module remain pinned — acceptable; the front-door `modelsOf`
  throw may only be retired once every consumer it guards is coordinate-clean (a half-migrated
  module silently mis-resolving is worse than one that throws).

## Project DoD

- A multi-namespace contract (≥2 namespaces, poly base with a variant in another namespace,
  relation crossing namespaces) is served correctly end-to-end by the ORM: reads, `.include()`
  (incl. polymorphic targets), `.variant()` narrowing, variant-aware predicates, mutations.
- `modelsOf()` / `domainModelsAtDefaultNamespace` are gone from `sql-orm-client`.
- No bare-name table/model lookup remains in the module (grep gate recorded in the final slice).
- Integration coverage on PGlite for the multi-namespace fixture; unit coverage for cross-namespace
  collision correctness.
- Follow-ups (interpreter materializer lookups, diagnostics UX) filed if surfaced, not silently
  absorbed.
