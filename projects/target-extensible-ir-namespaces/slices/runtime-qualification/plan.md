# Dispatch plan: runtime-qualification

_Slice spec: [`spec.md`](./spec.md). One PR. Single persistent implementer + reviewer. Sequential — each dispatch builds on the prior's stable hand-off._

**Shared validation gate** (each dispatch runs the subset covering its surface; the final verification dispatch runs all): `pnpm typecheck` · package-scoped `pnpm test` for touched packages · `pnpm lint:deps` · (final) `pnpm test:packages` + `pnpm test:integration` + `pnpm test:e2e` + `pnpm fixtures:check`.

### Dispatch 1: default-namespace foundation

- **Outcome:** A per-family/target runtime default-namespace identifier is importable (`defaultStorageNamespaceId` / `defaultDomainNamespaceId`, `'public'` for Postgres/SQL, `'__unbound__'` for Mongo/SQLite), mirroring authoring's `POSTGRES_DEFAULT_NAMESPACE_ID` / `defaultSqlNamespaceIdForTarget`; a shared resolver returns the `(namespaceId, table)` for a bare name using **default-namespace-first** ordering; `resolveSingleDomainNamespaceId`'s throw-on-multi behaviour is replaced by default-namespace resolution.
- **Builds on:** the spec's chosen design.
- **Hands to:** a stable importable default-namespace API + a `resolveStorageTable(storage, name)` / domain-model equivalent that every downstream dispatch calls instead of insertion-order scans.
- **Focus:** the constants + resolver only; no renderer or AST changes yet. No re-scattered `'public'` string literals.

### Dispatch 2: runtime SQL qualification — DSL path

- **Outcome:** `relational-core` `TableSource` carries a resolved namespace coordinate; the `sql-builder` proxy stamps it from D1's resolver; Postgres + SQLite query renderers qualify FROM/INSERT/UPDATE/DELETE table identifiers via the namespace concretion's `qualifyTable()`. A `db.sql.user` plan emits `"public"."user"` (Postgres) / `"user"` (SQLite). Adapter unit tests updated.
- **Builds on:** D1's default-namespace resolver.
- **Hands to:** the namespace-coordinate AST field + qualifying renderers — a stable rendering seam the ORM path reuses verbatim.
- **Focus:** DSL/proxy path + renderers + adapter tests. Column refs stay alias-qualified (unchanged). No ORM changes here.

### Dispatch 3: runtime SQL qualification — ORM path

- **Outcome:** `sql-orm-client` query plans stamp the namespace coordinate (reusing D2's AST field + renderers); model/table resolution (`orm.ts`, `collection-contract.ts`) goes through the default domain/storage namespace; ORM-emitted SQL is namespace-qualified. ORM-scoped tests pass.
- **Builds on:** D2's namespace-coordinate AST field + qualifying renderers.
- **Hands to:** both runtime query producers (DSL + ORM) emitting qualified SQL.
- **Focus:** `sql-orm-client` resolution + plan construction; no renderer changes (inherited from D2).

### Dispatch 4: query-builder type parity

- **Outcome:** `query-builder`'s `UnboundTables<C>` / `root.from(...)` types resolve tables across namespaces with default-namespace preference, at parity with `sql-builder`'s `TableNamesAcrossNamespaces`; a Postgres `public` contract type-checks against the flat builder surface (no longer `never`). Type-level tests cover it.
- **Builds on:** the spec's chosen design (independent of D2/D3 runtime work; ordered after for review locality).
- **Hands to:** a type-level flat surface consistent with the runtime resolution.
- **Focus:** `query-builder` types only.

### Dispatch 5: retire transitional projection helpers

- **Outcome:** `contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` (runtime) and `ContractModelsMap` / `ContractValueObjectsMap` (type-level) are removed from the foundation `contract` package; all consumers (now namespace-aware after D1–D4) resolve through the default-namespace API; `lint:deps` + `pnpm typecheck` clean.
- **Builds on:** D1–D4 (every consumer is namespace-aware before the transitional surface is pulled).
- **Hands to:** a foundation `contract` surface with no transitional single-namespace projection.
- **Focus:** deletion + final consumer migration; no new behaviour.

### Dispatch 6: Mongo runtime confirmation

- **Outcome:** the Mongo runtime resolves collections via the namespace coordinate; single-namespace (`__unbound__`) is a verified no-op (no qualification syntax); Mongo family tests green.
- **Builds on:** D1's default-namespace API.
- **Hands to:** confirmation that the cross-family resolution holds; Mongo unaffected.
- **Focus:** Mongo family/target runtime only; no Mongo multi-namespace work.

### Dispatch 7: verification, demo, fixtures

- **Outcome:** demo integration SQL expectations updated to qualified identifiers; `examples/prisma-next-demo/src/queries/*` compile and run unchanged; a multi-namespace Postgres contract is queryable end-to-end against PGlite (PDoD7); full gates green (`test:packages` + `test:integration` + `test:e2e` + `fixtures:check`).
- **Builds on:** D2/D3 qualified SQL; D5 clean surface.
- **Hands to:** green full-suite signal proving PDoD5/PDoD6/PDoD7.
- **Focus:** test/fixture/demo expectation updates + the e2e proof; no production logic changes (if a logic gap surfaces, route back to the owning dispatch).

### Dispatch 8: ADR + upgrade instructions

- **Outcome:** a short ADR records the default-namespace family-façade convention (project PDoD8 / OQ2); upgrade instructions recorded via `record-upgrade-instructions` if `examples/` or `packages/3-extensions/` *source* changed.
- **Builds on:** the settled design from D1–D7.
- **Hands to:** slice DoD met → PR.
- **Focus:** docs only.

## Open items

- Project **close-out** (PDoD9/PDoD10: Linear Completed, folder cleanup, predecessor-folder archival) is a project-level step via `drive-close-project` after this slice's PR merges — not a dispatch in this slice.
- If D2's AST-coordinate change forces touching SQL-plan serialization/fixtures beyond runtime objects, that is a stop-and-report (the spec scoped query plans as runtime, not on-disk).
