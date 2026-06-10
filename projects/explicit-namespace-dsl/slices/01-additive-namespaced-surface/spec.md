# Slice: additive namespaced DSL/ORM surface

_(Parent project `projects/explicit-namespace-dsl/`. Contributes: the explicit `sql.<ns>.<table>` / `orm.<ns>.<Model>` accessors exist and are queryable end-to-end — the new capability, added **without** removing today's flat surface, so this slice merges to main green.)_

## At a glance

Adds per-namespace facets to the SQL builder (`sql.<ns>.<table>`) and ORM client (`orm.<ns>.<Model>`), makes the ORM execution path namespace-aware so those accessors **query end-to-end** on a multi-namespace contract, exposes the surface through each target facade's `db`, and proves it end-to-end on a two-namespace PGlite fixture. The existing flat surface (`sql.<table>` / `orm.<Model>`) stays in place; removing it is slice 02's job. This is the additive half of the additive-then-cut split.

## Chosen design

### SQL builder — `packages/2-sql/4-lanes/sql-builder`

`Db<C>` today is a **flat** map keyed by every table name across all namespaces (`src/types/db.ts`), and `sql()` returns a single-level `Proxy` whose `get(prop)` calls `resolveTableForFlatName` (`src/runtime/sql.ts`). The file's own header comment already flags the namespaced surface as the tracked follow-up — this is it.

**Type (additive intersection):**

```ts
// new — a namespace facet: the tables of one storage namespace
export type Namespace<C extends TableProxyContract, NsId extends keyof C['storage']['namespaces']> = {
  readonly [Name in keyof C['storage']['namespaces'][NsId]['tables'] & string]: TableProxy<C, Name>;
};

// Db<C> gains namespace keys alongside the existing flat keys.
// Flat keys retained in this slice; slice 02 drops them, leaving only the mapped half.
export type Db<C extends TableProxyContract> =
  & { readonly [Name in TableNamesAcrossNamespaces<C>]: TableProxy<C, Name> }   // existing flat (retained)
  & { readonly [Ns in keyof C['storage']['namespaces']]: Namespace<C, Ns> };    // new namespaced
```

**Runtime (two-level proxy):** `sql()`'s `get(prop)` first checks whether `prop` is a declared storage namespace id (`prop in storage.namespaces`) → return a **namespace facet proxy** whose `get(table)` resolves the table *within that namespace coordinate* and constructs `TableProxyImpl(table, …, ctx, nsId)`. `TableProxyImpl` already accepts the `namespaceId` as its last constructor argument (see `runtime/sql.ts`), so the TML-2605 qualification machinery flows through unchanged — no parallel qualifier. If `prop` is not a namespace id, fall back to the existing flat `resolveTableForFlatName` path.

### ORM client — `packages/3-extensions/sql-orm-client`

Mirror the same shape on `orm()` (`src/orm.ts`): add an `orm.<ns>.<Model>` facet keyed on `contract.domain.namespaces`, returning the model collections scoped to that domain namespace; retain the flat `orm.<Model>` map. The domain-namespace keys must equal the SQL storage-namespace keys for the same contract (project AC2).

### ORM execution path — `packages/3-extensions/sql-orm-client` (folded in per operator decision)

Accessor *resolution* is not enough: the ORM execution core (`collection-contract.ts`) resolves model metadata through `domainModelsAtDefaultNamespace()`, which **throws on any multi-namespace contract**, so an `orm.<ns>.<Model>` query would throw on execution. This slice makes that path namespace-aware: the `Collection` carries its `namespaceId` (the namespace facet knows it) and `modelsOf()` / the metadata resolvers resolve *within that namespace* (`contract.domain.namespaces[nsId].models`, already directly accessible — no contract-foundation change). Additive: single-namespace execution is unchanged; flat bare-name access on a multi-namespace contract may still throw (ambiguous). This was discovered at dispatch time (the prerequisite TML-2605 qualified the SQL emission path, not the ORM metadata path); the operator chose to fold it into this slice rather than split it out.

### Facade reachability — postgres / sqlite / mongo extensions

The facades (`packages/3-extensions/postgres/src/runtime/postgres.ts` and the sqlite / mongo equivalents) return the `db` object whose `sql` / `orm` members are typed as the builder types above. Because `Db<C>` / the ORM client type are additive in this slice, the namespaced surface flows through `db.sql.<ns>.<table>` / `db.orm.<ns>.<Model>` automatically — plus the transaction-context and `prepare`-callback surfaces that re-type `sql` / `orm`. This slice ensures the namespaced shape is **reachable through the facade**, proven by the integration test. The `defaultNamespaceId`-keyed *exclusive* projection (alias-flat vs qualified-only) is **slice 02**, because it only does work once the flat surface is removed.

## Coherence rationale

One reviewable PR = "the namespaced accessor surface exists, **executes** end-to-end, and is proven on a real multi-namespace query." It is the "one new authoring surface end-to-end" slice-shape pattern: builder type-side → ORM type-side → ORM execution-awareness → facade reachability → integration proof. Nothing is removed — every change is additive (single-namespace behaviour is byte-for-byte unchanged), so even with the execution-core substrate change folded in, the slice remains one coherent "make the namespaced accessor real" unit. The operator accepted the heavier PR1 (decision (a)) over splitting the execution-awareness into its own slice.

## Scope

**In:**
- `sql.<ns>.<table>` facet (types + two-level proxy) in `sql-builder`, flat surface retained.
- `orm.<ns>.<Model>` facet in `sql-orm-client`, flat surface retained.
- ORM execution path made namespace-aware (`collection-contract.ts` metadata resolution scoped by the collection's namespace) so `orm.<ns>.<Model>` queries execute on multi-namespace contracts. Local to `sql-orm-client` — no contract-foundation change (halt-and-surface if one becomes necessary). Delivered across D3 (metadata core) → D4 (select + count CRUD) → D5 (returning mutations) → D6 (cross-namespace relation resolution + include reads) — the ORM execution core's single-namespace assumption is threaded layer by layer.
- **Cross-namespace relations** (`public.Profile.user → auth.User`) resolve and are queryable via the ORM accessor: ORM ops on a model that declares a relation execute on multi-namespace, and a cross-namespace `include` read returns the related row (per operator decision (a)). Cross-namespace nested-relation *writes* may remain a follow-up (D6 halts-and-surfaces if the proof needs them).
- Namespaced surface reachable through the postgres / sqlite / mongo facade `db` (incl. transaction + prepare surfaces).
- A two-namespace PSL fixture + emit + IR assertions + PGlite end-to-end query via **both** explicit accessor paths (`sql.<ns>.<table>` and `orm.<ns>.<Model>`).

**Out:**
- Cross-namespace nested-relation *writes* (nested `create`/`connect` of a related model in another namespace) — follow-up unless D6 finds the read + base-CRUD proof unavoidably needs them.

**Out (slice 02):**
- Removing the flat builder-layer accessors (the breaking cut).
- The `defaultNamespaceId`-keyed exclusive projection helper (alias for single-namespace, qualified-only for multi-namespace) and its type-level AC4/AC5 assertions.
- ADR, upgrade instructions, single-namespace regression snapshot of the *removed* shape.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Same bare table name in two namespaces (`public.users` + `auth.users`) | **Must be in the fixture** | Project AC1. The integration fixture must carry the same bare name in both namespaces so namespace-qualified resolution actually *discriminates* — a fixture with distinct names per namespace would pass even if qualification were broken (failure-mode F13: a regression test must fail under ¬P). |
| A namespace id that collides with a flat table name | Namespace id wins on the namespaced path; flat path unchanged | Additive intersection means `prop` is checked against `storage.namespaces` first. Document; do not add normalization magic (failure-mode F2). |

## Slice-specific done conditions

- [ ] Multi-namespace PGlite integration test exercises select / insert / update / delete on both namespaces and the cross-namespace FK relation via the explicit accessors, with the same bare table name present in both namespaces.

## Open Questions

1. Should the namespaced facet also be reachable as a top-level import (`sql.public`) in addition to through the facade `db.sql.public`? Working position: yes — `db.sql` *is* the builder `Db<C>`, so both are the same object; no extra work.

## References

- Parent project: `projects/explicit-namespace-dsl/spec.md`
- Linear: [TML-2816](https://linear.app/prisma-company/issue/TML-2816)
- Prerequisite (merged): TML-2605 runtime-qualification — `resolveStorageTable`, `TableProxyImpl(namespaceId)`, two-plane namespaced IR.
- Calibration: `drive/calibration/failure-modes.md` F2 (no constructor magic), F13 (regression test must discriminate).
