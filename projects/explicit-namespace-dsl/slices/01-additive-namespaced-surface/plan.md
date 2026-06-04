# Dispatch plan — slice 01: additive namespaced surface

Spec: [`./spec.md`](./spec.md). Sequence is sequential per the single persistent implementer; D1 and D2 are logically independent (different packages) but run back-to-back.

### Dispatch 1: SQL builder namespaced facet (additive)

- **Outcome:** `sql.<ns>.<table>` resolves the table in the named storage namespace and produces namespace-qualified SQL; the flat `sql.<table>` path still resolves unchanged. `Db<C>` is the additive intersection (flat ∩ per-namespace facets).
- **Builds on:** The spec's chosen design; the merged TML-2605 `TableProxyImpl(namespaceId)` + `resolveStorageTable`.
- **Hands to:** `Db<C>` carries `Namespace<C, NsId>` facets; `sql()` is a two-level proxy (namespace → table) delegating to the existing qualification path. The type `Namespace<C, NsId>` is exported from `sql-builder/types`.
- **Focus:** `packages/2-sql/4-lanes/sql-builder` only — `src/types/db.ts`, `src/runtime/sql.ts`, type-level + unit tests. No flat-surface removal. No facade edits.
- **Tests-first / gates:** type-level test (namespaced keys present; flat keys still present; unknown-`ns` is a type error) written before the impl; unit test that a bare name present in two namespaces resolves to the correct table per namespace. Gate: `pnpm --filter @prisma-next/sql-builder typecheck` (+ test tsconfig) + `pnpm --filter @prisma-next/sql-builder lint` + `pnpm --filter @prisma-next/sql-builder test` + `pnpm lint:deps`.

### Dispatch 2: ORM client namespaced facet (additive)

- **Outcome:** `orm.<ns>.<Model>` resolves the model accessor in the named domain namespace; flat `orm.<Model>` still resolves unchanged. ORM namespace keys equal SQL storage-namespace keys for the same contract.
- **Builds on:** D1's shape (mirrors it in the ORM package; independent package, no shared write scope).
- **Hands to:** `orm()` exposes per-namespace model-collection facets keyed on `contract.domain.namespaces`, flat map retained.
- **Focus:** `packages/3-extensions/sql-orm-client` — `src/orm.ts`, `src/storage-resolution.ts` (namespace key derivation), tests. No flat removal.
- **Tests-first / gates:** type-level test incl. `keyof (namespaced orm) === keyof (namespaced sql)` on a multi-namespace fixture, written first. Gate: same per-package shape as D1 for `@prisma-next/sql-orm-client`.

### Dispatch 3: ORM metadata-resolution namespace-awareness (additive) — DONE

- **Outcome:** the ORM **metadata-resolution** path resolves model metadata *within the collection's namespace* (`collection-contract.ts`'s `modelsOf()` + the five field/column/relation/polymorphism resolvers take an optional trailing `namespaceId`, caches namespace-keyed) instead of throwing via the `domainModelsAtDefaultNamespace()` default. Single-namespace resolution is byte-identical. Discriminating per F13 (same bare model name in two namespaces resolves distinct metadata).
- **Builds on:** D2's `orm.<ns>.<Model>` facet (knows its namespace coordinate; threads scoped table via `options.tableName`).
- **Hands to:** `Collection` carries its `namespaceId`; the metadata resolvers accept it (optional, default = sole-namespace path). Stable state D4 threads the same coordinate through the *execution* layer.
- **Focus:** `sql-orm-client` only — `collection-contract.ts`, `collection.ts`, `collection-internal-types.ts`, `orm.ts`. Foundation untouched. Landed in `8c06a7e2a` (test) + `ca0c29983` (feat).

### Dispatch 4: ORM execution-runtime namespace threading — select + count CRUD (additive) — DONE

- **Outcome:** `orm.<ns>.<Model>` **select** and **count-terminal** CRUD (`createCount`/`updateCount`/`deleteCount`) execute on a multi-namespace contract — `collection-runtime.ts`, `collection-column-mapping.ts`, `model-accessor.ts`, `filters.ts`, `collection-dispatch.ts`, `query-plan-select.ts` thread the collection's `namespaceId`. Single-namespace execution byte-identical.
- **Builds on:** D3's namespace-keyed metadata resolvers.
- **Hands to:** select + count CRUD execute per-namespace against a mock runtime. **Returning-row mutations** (`create`/`update`/`delete` returning the row) route through `mutation-executor.ts` — not yet threaded; that's D5.
- **Focus:** `sql-orm-client` execution-runtime files. Foundation untouched. Landed in `81ec6e57c` (test) + `a8f11cc2f` (feat).

### Dispatch 5: ORM returning-mutation execution threading (additive)

- **Outcome:** `orm.<ns>.<Model>` **returning-row** mutations (`create` / `createAll` / `update` / `updateAll` / `delete` / `deleteAll`) execute on a multi-namespace contract — `mutation-executor.ts` (`dispatchMutationRows` row-shaping, `buildPrimaryKeyFilterFromRow`, the returning-row mapping path) threads the collection's `namespaceId` for **base-model** writes. Single-namespace execution byte-identical.
- **Builds on:** D4 (select + count CRUD threaded; the `namespaceId` coordinate flows from `Collection` into the dispatch layer).
- **Hands to:** full base-model CRUD (returning + count) executes per-namespace; D7's PGlite proof can exercise returning mutations on the ORM accessor path.
- **Focus:** `sql-orm-client` — `mutation-executor.ts` + any returning-row shaping helper it calls. **Cross-namespace nested-relation writes are out of slice-01 scope** (the related model in another namespace) — halt-and-surface if base-model returning mutations unavoidably require them. Foundation halt-and-surface rule as D3/D4.
- **Tests-first / gates:** test (FIRST) exercising a returning `create` + `update` (or `delete`) via `orm.<ns>.<Model>` on a two-namespace same-bare-name contract (mock runtime acceptable), per-namespace-correct, discriminating (F13). Single-namespace returning-mutation regression green. Gate: per-package typecheck + lint + test for `@prisma-next/sql-orm-client` + `pnpm lint:deps`.

### Dispatch 6: cross-namespace relation resolution (additive)

- **Outcome:** ORM operations on a model that **declares a relation** execute on a multi-namespace contract, and a **cross-namespace relation** (`public.Profile.user → auth.User`) resolves and is queryable via the ORM accessor — `getRelationDefinitions`'s relation-*target* resolution (`mutation-executor.ts` ~698/702, `resolveFieldToColumn(relation.to, …)`) and the include-read traversal resolve the target model's metadata within **`relation.to.namespace`** instead of the default/first-match path. Single-namespace behaviour byte-identical.
- **Builds on:** D5 (base-model write threading; the relation-*target* sites D5 deliberately left at default resolution are the surface here).
- **Hands to:** the cross-namespace FK fixture's `Profile`↔`auth.User` relation is queryable end-to-end via ORM — base CRUD on a model-with-relations + a cross-namespace `include` read. D8's PGlite proof can exercise the FK-mediated relation through the ORM path.
- **Focus:** `sql-orm-client` — relation-target resolution in `mutation-executor.ts` / `collection-contract.ts` (`resolveIncludeRelation` target) / the include-read path. Thread `relation.to.namespace` (cross-references already carry their namespace). **Cross-namespace nested-relation *writes*** (a nested `create`/`connect` of a related model in another namespace) may stay out of scope — **halt and surface** if the D8 fixture's read + base-CRUD proof unavoidably needs them, so we size that explicitly rather than ballooning silently. Foundation halt-and-surface rule as D3–D5.
- **Tests-first / gates:** test (FIRST) on a two-namespace contract with a cross-namespace FK relation: ORM base CRUD on the relation-declaring model executes, and a cross-namespace `include` read returns the related row from the other namespace; discriminating (F13). Single-namespace relation behaviour green. Gate: per-package typecheck + lint + test for `@prisma-next/sql-orm-client` + `pnpm lint:deps`.

### Dispatch 7: coordinate-aware core column/codec resolvers (additive) — DONE

- **Outcome (corrective):** the core resolvers `resolveStorageTable` (`sql-contract`), `codecRefForStorageColumn` (`relational-core`), and `resolveTableColumns`/`storageTableForContract` (`sql-orm-client`) take an optional trailing `namespaceId`: coordinate ⇒ strict within-namespace resolution; ambiguous bare name without a coordinate ⇒ **fail-fast naming the namespaces** (FR11) instead of silent first-match. Closes the codec-layer gap that distinct-table-name fixtures had masked. Additive; single-namespace byte-identical; no contract-IR/emitter/JSON change.
- **Builds on:** D1–D6 (the coordinate is already present at every call site: `TableSource.namespaceId`, `relation.to.namespace`).
- **Hands to:** D8 threads the coordinate (already in hand) into every column/codec call site so same-bare-TABLE-name resolves correctly. Landed in `3fccb8d2a` (test) + `48a3dc2ad` (feat).

### Dispatch 8: thread the coordinate through all column/codec call sites + re-prove AC1 (additive)

- **Outcome:** every SQL-builder + ORM column/codec call site passes the namespace coordinate it already holds into the D7 resolvers — `sql-builder` `builder-base.codecRefFor`/`tableToScope` (from `TableProxyImpl.namespaceId`), ORM `query-plan-select` `buildProjection`, `query-plan-mutations`, `query-plan-aggregate`, `where-binding`, `model-accessor`, and the include child-SELECT projection (from `relatedNamespaceId`). After D8, **same bare TABLE name in two namespaces with differing columns resolves correctly through every path** (`sql.<ns>.<table>`, `orm.<ns>.<Model>`, cross-ns include child SELECT). AC1 is delivered for real.
- **Builds on:** D7 (coordinate-aware resolvers).
- **Hands to:** the codec/column layer is namespace-correct end-to-end; D10's PGlite proof can use a genuine same-bare-TABLE-name + differing-columns fixture including the cross-ns include target.
- **Focus:** `sql-builder` (`builder-base.ts`) + `sql-orm-client` call sites listed above. **Also fix the pre-existing D2-era facade-test break** (`@prisma-next/postgres` `postgres.test.ts` mock-cast invalidated by D2's namespaced `OrmClient` index signature; check sqlite/mongo facade tests for the same) — **separate commit, scope-note** — so the workspace typecheck gate is green.
- **Tests-first / gates:** re-prove with a same-bare-TABLE-name + **differing-columns** fixture: `sql.public.users`/`sql.auth.users` and `orm.public.User`/`orm.auth.User` resolve distinct columns/codecs; strengthen the D1–D6 tests that used distinct table names; discriminating (F13). Gate: per-package typecheck + lint + test for `@prisma-next/sql-builder` + `@prisma-next/sql-orm-client`, **`pnpm typecheck` (workspace — mirror CI; F14)**, `pnpm lint:deps`.

### Dispatch 9: facade reachability (postgres / sqlite / mongo)

- **Outcome:** The namespaced surface is reachable through each facade's `db` — `db.sql.<ns>.<table>` and `db.orm.<ns>.<Model>` resolve, including inside `transaction(...)` and `prepare(...)`. Existing flat call sites through `db` still typecheck and run.
- **Builds on:** D1 + D2 (the builder/ORM types now carry the facets; the facade members re-type to them). Independent of the D3–D8 execution work; all must land before D10's integration proof.
- **Hands to:** All three facades expose both shapes additively; facade type re-exports (`Db`, ORM client type) updated where they pin the shape.
- **Focus:** `packages/3-extensions/postgres`, the sqlite extension, `packages/3-mongo-target/1-mongo-target` (mongo facade) — facade + transaction-context + prepare typings only. No projection helper (that is slice 02).
- **Tests-first / gates:** existing facade type-tests extended to assert the namespaced member shape. Gate: per-package typecheck + lint + test for each touched facade + `pnpm lint:deps`.

### Dispatch 10: multi-namespace integration proof (Postgres / PGlite)

- **Outcome:** A two-namespace PSL fixture (`public` + `auth`, **same bare table name in both, with differing columns**, plus a cross-namespace FK) is authorable → emittable (`contract.json` with both `domain.namespaces` and `storage.namespaces` keyed by id; FK carries the cross-namespace coordinate) → queryable end-to-end on PGlite via **both** explicit accessor paths: `sql.<ns>.<table>` and `orm.<ns>.<Model>`, covering select / insert / update / delete on both namespaces and the FK-mediated cross-namespace relation (incl. an ORM `include` read across namespaces).
- **Builds on:** D8 (same-bare-TABLE-name resolves correctly through every path) + D9 (accessors reachable through the postgres facade).
- **Hands to:** Project AC1 / AC2 / AC6 covered by a committed integration test; the multi-namespace fixture exists for slice 02 to reuse.
- **Focus:** new integration test + PSL fixture. **Fixture uses the genuine same-bare-TABLE-name + differing-columns shape** (the deferred-core-boundary corner is reversed — D7/D8 make this correct, including the cross-ns include target). The fixture must straddle the boundary (F13): the two same-named tables differ in columns so first-match would fail.
- **Tests-first / gates:** the integration test *is* the deliverable. Gate: the PGlite integration test green + `pnpm fixtures:check`.

### Dispatch 11: single-namespace regression (SQLite / Mongo) + snapshot

- **Outcome:** Existing single-namespace fixtures on SQLite and Mongo still resolve flat `db.<Model>` / `db.sql.<table>` unedited (additive change broke nothing); the single-namespace `contract.json` snapshot is byte-identical (project FR7 / TC-19).
- **Builds on:** D9.
- **Hands to:** Confidence that the additive surface is non-breaking; slice 02 inherits a green single-namespace baseline to alias against.
- **Focus:** run/extend existing sqlite + mongo integration fixtures; assert no contract.json snapshot drift. No new call-site edits.
- **Tests-first / gates:** existing fixtures pass unedited; snapshot diff empty. Gate: sqlite + mongo integration tests + `pnpm fixtures:check`.

## Slice-close gate

Before PR-open: sync `origin/main`, re-run `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps` + `pnpm fixtures:check` (F14 / slice-close ritual).

## Open items

- D3 mongo facade lives in `packages/3-mongo-target/1-mongo-target`; confirm the mongo ORM surface mirrors the SQL ORM facet shape (it uses a separate query-builder package, `packages/2-mongo-family/5-query-builders/orm`). The implementer's D3 pre-flight grep confirms the exact mongo touch-points.
