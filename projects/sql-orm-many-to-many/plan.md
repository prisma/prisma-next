# SQL ORM — Many-to-Many End to End — Plan

**Spec:** `projects/sql-orm-many-to-many/spec.md`
**Linear Project:** [SQL ORM: Many-to-Many End to End](https://linear.app/prisma-company/project/sql-orm-many-to-many-end-to-end-c178df40ca3a) (planning record: TML-2597, `Plan: …`, Done)

## At a glance

Four slices: one **foundation slice** (slice 0) that makes M:N a validatable contract shape and surfaces the shared `through` descriptor, then a **three-way parallel fan-out** — read, filter, write — each consuming slice 0's hand-off and independent of the others.

## Composition

### Stack (deliver in order)

1. **Slice `00-contract-resolver-foundation`** — Linear: [TML-2784](https://linear.app/prisma-company/issue/TML-2784)
   - **Outcome:** An M:N relation (`rel.manyToMany` with `through`) emits a contract that round-trips `validateContract`; the shared resolver surfaces a uniform `through` descriptor (and the junction's required-non-FK-column info); the cardinality tag is canonicalised on `'N:M'` repo-wide.
   - **Builds on:** None (correlated-only read path from TML-2729 / TML-2657 already on `main`).
   - **Hands to:** (a) a validatable M:N contract shape — `through: { table, parentColumns, childColumns }` declared in the JSON schema + arktype validator + `ContractReferenceRelation` type; (b) `ResolvedRelation.through` + required-payload-column info on `resolveModelRelations`; (c) a single `'N:M'` cardinality tag with no `'M:N'` left in sql-orm-client.
   - **Focus:** contract surface (`packages/2-sql/1-core/contract` validator, `data-contract-sql-v1.json`, `ContractReferenceRelation` type, delete the `as ContractRelation['cardinality']` cast in `build-contract.ts`) + the orm-client resolver. Reconcile the `parentCols/childCols` field-name drift to `parentColumns/childColumns`. Does **not** teach any consumer (read/filter/write) to use `through` — that's slices 1–3. `pnpm fixtures:check` regen is in-scope.

### Parallel group (each builds on slice 0; mutually independent)

- **Slice `01-correlated-read-through-junction`** — Linear: [TML-2785](https://linear.app/prisma-company/issue/TML-2785)
  - **Outcome:** `db.orm.User.include('tags')` returns `{ …user, tags: Tag[] }` for an M:N relation, in a single SQL execution (one correlated subquery walking the junction, no LATERAL).
  - **Builds on:** Slice 0's `ResolvedRelation.through`.
  - **Hands to:** the include-projection junction-walk pattern (a reference for how filter/write traverse `through`).
  - **Focus:** extend `buildCorrelatedIncludeProjection` (`query-plan-select.ts`) to correlate parent → junction → target; PG + SQLite integration tests. No LATERAL, no multi-query.

- **Slice `02-filter-exists-through-junction`** — Linear: [TML-2786](https://linear.app/prisma-company/issue/TML-2786)
  - **Outcome:** `.filter((u) => u.tags.some/every/none(...))` emits an EXISTS subquery that walks the junction for M:N relations.
  - **Builds on:** Slice 0's `ResolvedRelation.through`.
  - **Hands to:** correctly-shaped M:N relation filters (consumed by any query using `.some/.every/.none`).
  - **Focus:** teach `buildJoinWhere` / `createRelationFilterAccessor` (`model-accessor.ts`) to add the junction hop; PG + SQLite integration.

- **Slice `03-nested-write-through-junction`** — Linear: [TML-2787](https://linear.app/prisma-company/issue/TML-2787)
  - **Outcome:** Nested `connect` / `disconnect` / `create` over M:N route to junction INSERT / DELETE under both `create()` and `update()`; nested `.create` over a required-payload junction is disabled at types **and** runtime.
  - **Builds on:** Slice 0's `ResolvedRelation.through` + required-payload-column info.
  - **Hands to:** the relation-shaped M:N write API (the shape the Pothos plugin wires against).
  - **Focus:** remove the `partitionByOwnership()` "not supported yet" guard; route M:N as junction writes (not parent-/child-owned); flip the rejection unit test to positive; the type-level `.create` disable on required-payload junctions is its own dispatch. **Heaviest slice — re-check *Small* at `drive-plan-slice`; split the type-level disable into its own slice if it doesn't hold as one review.**

## Dependencies (external)

- [x] Correlated-only read path (TML-2729, PR #667) landed on `main` — slice 1 extends `buildCorrelatedIncludeProjection`, which exists.
- [x] Single-query mutation read-back (TML-2657) landed — no multi-query stitcher to reconcile.

## Sequencing rationale

Slice 0 is a hard gate, not a stylistic choice: until the contract validates an M:N relation and the resolver surfaces `through`, slices 1–3 have no validatable integration fixture to test against and nothing to read `through` from. Once slice 0 lands, the three consumers touch disjoint files (`query-plan-select.ts` / `model-accessor.ts` / `mutation-executor.ts`) and share only the read-only `ResolvedRelation.through` field — no write-write contention — so they parallelise cleanly. They are sequenced after 0 purely by data dependency, not by reviewer pacing.
