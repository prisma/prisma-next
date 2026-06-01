# Dispatch plan — TML-2683

Four dispatches, strictly sequential. Each is tests-first per the repo rule ("always write
tests before creating or modifying implementation"). The SQL→decode order is mandated by the
ticket (data must be present before it can be mapped); the `.variant()` surface rides on top;
integration coverage confirms the whole.

> **Baseline:** both predecessors are assumed landed — TML-2657 (multi-query include path
> removed) and TML-2729 (LATERAL dropped; correlated-only read path). The plan targets that
> tree: the **single correlated include builder** (`buildCorrelatedIncludeProjection`, sharing
> `buildIncludeChildRowsSelect` with no `strategy` param); no multi-query stitcher and no
> lateral builder to extend. The original #619 blocker is resolved.

### Dispatch 1: SQL side — emit polymorphism joins + projection in the child SELECT

- **Outcome:** for a `.include()` whose target model is polymorphic, the correlated child
  SELECT (via `buildIncludeChildRowsSelect` **and** the `buildDistinctNonLeafChildRowsSelect`
  branch) resolves `resolvePolymorphismInfo(include.relatedModelName)` and, when MTI variants
  exist, emits `buildMtiJoins(...)` joins + `variant_table__column` projection inside the
  correlated subquery, choosing inner-vs-left join from `include.nested.variantName`. Because
  2729 dropped the child SELECT's `.withJoins(nestedJoins)`, this dispatch re-introduces
  `.withJoins(...)` as the (now sole) join source. The discriminator column and STI
  variant-specific (base-table) columns are projected. A variant-specific `where` on the
  refinement evaluates (the variant tables are now in scope).
- **Builds on:** the spec's chosen design; the post-2657/post-2729 correlated-only tree.
- **Hands to:** child storage rows for poly-target includes carry the discriminator + all
  variant columns; `include.nested.variantName` is honored in emitted SQL. (Rows are
  correctly *fetched* but still base-*mapped* until D2 — observable via query-plan unit tests,
  not yet via decoded row shape.)
- **Focus:** `query-plan-select.ts` — `buildIncludeChildRowsSelect`,
  `buildDistinctNonLeafChildRowsSelect`, reached via `buildCorrelatedIncludeProjection`.
  Tests-first: `test/query-plan-select.test.ts` — assert the correlated child SELECT's
  joins/projection for STI-target and MTI-target includes, variant-narrowed inner join,
  self-relation alias remap. Use `buildStiPolyContract` / `buildMixedPolyContract`
  (`test/helpers.ts`), extending with a parent→poly relation if absent. **Not** the decoder,
  **not** the `.variant()` type surface. (Note: 2729 collapsed `nested-includes-strategy.test.ts`
  to a single correlated path — write new poly assertions against that single path, not a
  lateral/correlated matrix.)

### Dispatch 2: Decode side — map poly child rows to their variant

- **Outcome:** `decodeIncludePayload` resolves `PolymorphismInfo` once per include for
  `include.relatedModelName` and, when polymorphic, maps each child row via
  `mapPolymorphicRow(contract, relatedModelName, polyInfo, childRow, include.nested.variantName)`
  instead of `mapStorageRowToModelFields`. Nested-include recursion, scalar, and combine
  branches are unchanged. Included poly rows come back shaped as the variant each row is.
- **Builds on:** Dispatch 1's hand-off — child rows carry the discriminator + variant columns.
- **Hands to:** runtime-correct variant row shapes for poly-target includes (unit-level);
  STI variant fields present and per-row-correct, MTI variant columns present.
- **Focus:** `collection-dispatch.ts` (`decodeIncludePayload:504`). Tests-first:
  `test/collection-dispatch.test.ts` — STI child rows decode to the right variant by
  discriminator; MTI child rows surface variant columns; variant-narrowed include maps to the
  named variant. **Not** the SQL builder, **not** the public `.variant()` API surface (unit
  tests set `nested.variantName` on state directly).

### Dispatch 3: `.variant()` narrowing surface on include refinements (type + wiring)

- **Outcome:** `db.orm.<parent>.include('<polyRel>', r => r.variant('X'))` type-checks, sets
  `nested.variantName = 'X'`, and the included relation's value type narrows to variant `X`'s
  row type (mirroring parent `Collection.variant()`). At runtime the discriminator filter +
  inner-join-named-variant already fire (D1/D2 read the slot); this dispatch makes the
  operator reachable and correctly typed on the refinement collection.
- **Builds on:** D1 + D2 (SQL + decode already honor `nested.variantName`).
- **Hands to:** typed, runtime-correct variant narrowing on includes — the full
  acceptance-criteria API surface exists.
- **Focus:** `collection.ts` include-refinement collection type (`IncludeRefinementCollection`,
  refinement creation `:434`) + the result-type mapper (`IncludeRefinementValue`). Tests-first:
  type-level `test-d` (result row type = variant union; `.variant('X')` narrows) +
  a unit test that the refinement `.variant()` sets `nested.variantName`. **Not** new SQL or
  decode logic — those already consume the slot.

### Dispatch 4: Integration coverage — STI + MTI target includes on a real DB

- **Outcome:** integration tests in `test/integration/test/sql-orm-client/` exercise
  `.include('<polyRel>')` for an STI-target and an MTI-target relation against **PGlite
  (Postgres)** — the only target this suite runs (see design-notes D4) — asserting
  variant-correct row shapes, an **STI** variant-specific `where` on the refinement, and a
  `.variant()`-narrowed include. A polymorphic-relation fixture (parent model + STI poly target
  + MTI poly target) + seed helpers are added (none exists today).
- **Builds on:** D1 + D2 + D3 (the full read path + narrowing API).
- **Hands to:** PGlite integration coverage; the silent-degradation regression is locked by
  acceptance-level tests. Surfaced the MTI variant-`where` gap → D5.
- **Focus:** integration fixture/contract + seeds + tests. **Not** production-code changes — a
  surfaced gap halts and re-opens the relevant dispatch (which is exactly what happened: the MTI
  variant-`where` gap routed to D5). Standalone poly contract per the sanctioned resize.
- **Status:** delivered 5 PGlite tests (commit `34becbd8a`); MTI variant-`where` case to be
  added in D5 once the accessor fix lands.

### Dispatch 5: MTI variant-field `where` — variant-aware predicate accessor

- **Outcome:** a variant-specific `where` referencing an **MTI** variant column on a poly include
  refinement (e.g. `.include('tasks', t => t.variant('Feature').where(x => x.priority.gte(3)))`)
  type-checks and evaluates correctly at runtime — the predicate accessor resolves the variant's
  columns (merged from the selected variant) and qualifies their `ColumnRef` against the variant
  table D1 already joins into the child SELECT. The D4 integration test is extended with the MTI
  variant-`where` case (PGlite), and unit coverage pins the accessor/where-binding behavior.
- **Builds on:** D1 (variant tables joined into the child SELECT), D3 (`.variant()` surface), D4
  (the integration fixture + the STI `where` case to mirror).
- **Hands to:** AC-3 fully discharged for both STI and MTI; slice-DoD met.
- **Focus:** `model-accessor.ts` (make `createModelAccessor` variant-aware — merge variant
  columns, qualify `ColumnRef` to the variant table) + the `where`-binding path; reuse the merged
  field→column map pattern from the mutation path (`collection.ts` ~`:1274`). Tests-first: unit
  (predicate resolves an MTI variant column to the variant-table `ColumnRef`) + extend the D4
  integration test. **Not** the SQL join emission (D1 already joins the table) or the decode path.

## Handoff linearity

D1→D2→D3→D4→D5 is linear. Completeness: D1+D2 discharge "rows match their variant"; D3 discharges
the `.variant()` narrowing API + type-shape; D4 discharges PGlite integration coverage + STI
variant-`where`; D5 discharges MTI variant-`where` (the AC-3 remainder). D4 surfaced the D5 gap —
a non-linear discovery, recorded in design-notes D3.

## Manual QA

**N/A** — the change is library-internal read-path behavior with no CLI/UI surface; the
acceptance surface is the D4/D5 integration tests (real DB, PGlite). Recorded here as an
explicit N/A per the slice-DoD requirement.

## Whole-slice DoD

- `pnpm test:packages typecheck lint:deps` green at the slice tip.
- `pnpm test:integration` green on Postgres (PGlite). *(SQLite poly-include coverage deferred —
  design-notes D4.)*
- Type-level tests assert the variant-union result shape and `.variant()` narrowing.
- PR description is the slice spec (`projects/tml-2683/spec.md`) + Linear back-link.
