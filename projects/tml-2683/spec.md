# Slice: wire polymorphism into the `.include()` child path

_Standalone ticket-scoped slice (no parent Drive project). Linear project: Pothos
Integration. One PR, one reviewer sitting._

## At a glance

`db.orm.<parent>.include('<rel>')` where `<rel>`'s target model is polymorphic (STI or
MTI) currently returns wrong-shaped rows (STI: variant fields dropped/confused) or
missing-field rows (MTI: variant columns never fetched), silently. This slice wires the
parent-side polymorphism machinery — already correct — into the **child** include path:
the single-query SQL builders emit the variant joins/projection, the decoder maps each
child row to its real variant, and `r => r.variant('X')` narrows a polymorphic include the
same way `Collection.variant()` narrows a root query.

## Chosen design

The parent path is the template; the child path copies it. Two reads/writes of the
**existing** `IncludeExpr.nested.variantName` slot (`types.ts:60`, `:75`) tie it together.

> **Baseline: post-2729, correlated-only.** This slice plans against the tree after
> [TML-2729](https://linear.app/prisma-company/issue/TML-2729) — LATERAL is removed from the
> include read path and all SQL targets emit correlated subqueries. `buildLateralIncludeArtifacts`,
> `include-strategy.ts` / `selectIncludeStrategy`, and the `strategy: 'lateral' | 'correlated'`
> param are gone. `compileSelectWithIncludeStrategy` is renamed `compileSelectWithIncludes`.
> The single remaining include builder is the correlated projection builder, sharing
> `buildIncludeChildRowsSelect`. **Function names below are post-2729; line numbers are
> omitted where 2729 shifts them.**

### Baseline (parent correct, child absent)

```
compileSelectWithIncludes (query-plan-select.ts)            // renamed by 2729, no strategy param
├─ PARENT: resolvePolymorphismInfo(modelName)  ─┐  ✅ wired (outer SELECT joins; untouched by 2729)
│          buildMtiJoins(...) → joins+projection │
└─ for each include:
     buildCorrelatedIncludeProjection            // the only include builder post-2729
        └─ buildIncludeChildRowsSelect           // no strategy param; nested joins removed by 2729
             SELECT <base cols> FROM <relatedTableName>      ❌ no resolvePolymorphismInfo
             WHERE <correlation to parent> [AND <child where>]   ❌ no buildMtiJoins
                                                             ❌ no variant/discriminator projection
             // 2729 also dropped `.withJoins(nestedJoins)` here — the child SELECT now has
             // NO join source at all (nested includes are projection-only correlated subqueries)

decodeIncludePayload (collection-dispatch.ts:504)
└─ mapStorageRowToModelFields(contract, include.relatedModelName, childRow)   ❌ base mapper
                                          (relatedModelName = relation.to = BASE model)
```

### After

```
buildIncludeChildRowsSelect (and buildDistinctNonLeafChildRowsSelect):
   polyInfo = resolvePolymorphismInfo(contract, include.relatedModelName)
   if polyInfo?.mtiVariants.length:
       { joins, projection } = buildMtiJoins(contract, polyInfo, include.nested.variantName)
       → re-introduce `.withJoins(joins)` on the child correlated SELECT  (it joins the
         variant tables to the base on PK — valid inside a correlated subquery's FROM; this
         is the child SELECT's only join source post-2729);
         add projection (variant_table__column) to childProjection
   ensure the discriminator column + STI variant columns are projected from the base table
   (so the decoder can resolve variant per row even with no MTI join)

decodeIncludePayload:
   polyInfo = resolvePolymorphismInfo(contract, include.relatedModelName)   // once per include
   row = polyInfo
       ? mapPolymorphicRow(contract, include.relatedModelName, polyInfo, childRow, include.nested.variantName)
       : mapStorageRowToModelFields(contract, include.relatedModelName, childRow)

include refinement:
   r.variant('X')  →  sets nested.variantName = 'X'  (Collection.variant already does this;
                       expose it on the IncludeRefinementCollection type + narrow the
                       included relation's result type to the 'X' variant row union member)
```

`buildMtiJoins` already emits `variant_table__column`-aliased projections and chooses `inner`
vs `left` join by `variantName`; `mapPolymorphicRow` (`collection-runtime.ts:96`) already
understands that exact alias (via `getMergedColumnToFieldMap`) and reads the per-row
discriminator. Both are reused verbatim — the child path only needs to *call* them. The MTI
variant join is an ordinary base⋈variant-on-PK join inside the correlated subquery's FROM; it
is unrelated to the LATERAL machinery 2729 removed (which joined *nested includes*, not
variant tables).

### Worked example

`Role` is STI (`AdminRole` / `GuestRole`, discriminator `kind`, `AdminRole.permissions`,
`GuestRole.invitedBy`). `db.orm.user.include('roles')`:

- **Before:** each role row shaped as base `Role`; `permissions` / `invitedBy` dropped or
  mis-mapped. No error.
- **After:** each role row is the variant its `kind` says — `{ ..., permissions }` for
  admin rows, `{ ..., invitedBy }` for guest rows.

MTI `Role` (variant tables `admin_roles` / `guest_roles`): before, variant columns are
absent entirely (no join); after, they are joined into the child SELECT and surface on the
row. `db.orm.user.include('roles', r => r.variant('Admin'))` inner-joins only `admin_roles`
and the result type narrows to the admin variant.

## Coherence rationale

One reviewable change: "teach the single-query include builder family + its decoder about
the polymorphism metadata they currently ignore, and expose the narrowing operator that
rides the same slot." All three pieces (SQL emit, decode map, `.variant()` surface) read or
write one shared concept — `include.nested.variantName` + the related model's
`PolymorphismInfo` — and are individually meaningless: SQL without decode returns
correctly-fetched-but-base-mapped rows; decode without SQL has no variant columns to map;
`.variant()` without both is an inert flag. They ship as one PR so the reviewer holds the
parent↔child symmetry in one sitting.

## Scope

**In:**

- `query-plan-select.ts` — `buildIncludeChildRowsSelect` and
  `buildDistinctNonLeafChildRowsSelect` resolve polymorphism for `include.relatedModelName`
  and emit MTI variant joins (re-introducing `.withJoins(...)` on the child correlated SELECT)
  + variant/discriminator projection, honoring `include.nested.variantName`. Reached via the
  sole post-2729 include builder `buildCorrelatedIncludeProjection`.
- `collection-dispatch.ts` — `decodeIncludePayload` (`:504`) maps poly-target child rows via
  `mapPolymorphicRow` instead of `mapStorageRowToModelFields`.
- `collection.ts` / type surface — expose `.variant()` on the include-refinement collection
  type and narrow the included relation's result type to the variant union member.
- Variant-specific `where` on a poly include refinement evaluates correctly. For **STI** this
  falls out of the SQL-side joins (the variant columns live on the base table the predicate
  accessor already resolves). For **MTI** it does *not* — the predicate accessor
  (`model-accessor.ts`) resolves fields against the base table only, so a variant column on a
  joined variant table is unreferenceable; the accessor must become variant-aware (merge the
  selected variant's columns, qualifying their `ColumnRef` against the variant table D1 already
  joins into the child SELECT). Delivered by **D5**. *(Discovered during D4 — see design-notes D4.)*
- Tests: unit (`test/query-plan-select.test.ts`, `test/collection-dispatch.test.ts`),
  types (`test/polymorphism.test-d.ts` or a new `test-d`), integration
  (`test/integration/test/sql-orm-client/`), plus a polymorphic-relation fixture for the
  integration suite (none exists today).

**Out:**

- The multi-query stitcher path — already removed by TML-2657 (landed); nothing to extend.
- LATERAL include emission — already removed by TML-2729 (assumed landed); the child SELECT
  is correlated-only. This slice does not touch `JoinAst.lateral`, the postgres renderer's
  LATERAL emission, the public `lateralJoin()` DSL, or the `lateral` capability flag — all of
  which 2729 deliberately keeps.
- A scalar-reducer-specific dispatch. Scalar reducers on poly-target relations inherit the
  SQL-side variant-join fix automatically (same builder family) once the include-aggregates
  slice (TML-2588 / TML-2595) lands; no row-decode work applies to a primitive. See
  `design-notes.md`.
- Mutation-path includes (read path only).
- Any change to the contract emitter or polymorphism metadata shape — all consumed
  metadata (`discriminator`, `variants`, variant `storage.table`) already exists.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| STI variant columns live on the **base** table | In — handled by projection | No MTI join exists for STI; the child SELECT must still project the discriminator + the variant-specific base-table columns, else the decoder has nothing to map. Confirm `buildProjection` over the base model's `selectedFields` does **not** already drop variant columns. |
| Self-relation poly include (`childTableAlias` set) | In — must remap | When the base table is aliased, `buildMtiJoins`' join-`ON` references the unaliased base table name and falls out of scope. The existing alias-remap that `buildIncludeChildRowsSelect` applies to `orderBy`/`where` must also cover the variant joins. |
| `distinct()` on a non-leaf poly include | In — second emit site | `buildDistinctNonLeafChildRowsSelect` is a separate child-SELECT builder; the variant joins/projection must be added there too, not only the plain branch. |
| Empty relation (no child rows) | Inherited — no new work | Existing empty-relation handling (`coerceSingleQueryIncludeResult`, no-LATERAL-row short-circuit) is variant-agnostic. |

## Slice-specific done conditions

- [ ] A new polymorphic-relation fixture (STI-target **and** MTI-target relation off a
      parent model) exists in the integration suite and is committed; integration tests pass
      on **PGlite (Postgres)**. *(Amended from "PGlite + SQLite" — see design-notes D4: the
      `sql-orm-client` integration suite is Postgres-only; the emitted variant-join lowering is
      target-agnostic, so PGlite exercises the D1–D3 logic. SQLite poly-include coverage is a
      deferred follow-up, gated on the sqlite contract-builder gaining polymorphism support.)*
- [ ] Variant-specific `where` works end-to-end on a real DB for **both** STI (base-table
      column) and MTI (variant-table column, via the D5 variant-aware predicate accessor).
- [ ] Type-level test asserts `.include('<polyRel>')` result row type = the variant union,
      and `.include('<polyRel>', r => r.variant('X'))` narrows to variant `X`.
- [ ] `pnpm fixtures:check` clean (if any emitted fixture/contract changes).

## Open Questions

1. Does `IncludeRefinementCollection` already expose `.variant()` at the type level, or is
   it stripped in `includeRefinementMode`? Working position: it is likely **not** exposed
   (the refinement surface is curated); the `.variant()` dispatch adds it explicitly and
   narrows the result type. Resolve by grep at dispatch time.
2. Can the integration suite's shared `getTestContract()` be extended with poly models, or
   does the poly fixture need a standalone contract + seed helpers? Working position:
   standalone poly contract + seed helpers (keeps the shared contract stable); confirm at
   the integration dispatch.

## References

- Linear issue: [TML-2683](https://linear.app/prisma-company/issue/TML-2683)
- Predecessors (both assumed landed): [TML-2657](https://linear.app/prisma-company/issue/TML-2657)
  (remove multi-query include path) and [TML-2729](https://linear.app/prisma-company/issue/TML-2729)
  (drop LATERAL; correlated-only read path)
- Decisions: `projects/tml-2683/design-notes.md`
- Parent-side template: `compileSelectWithIncludes` (renamed by 2729; parent MTI joins via
  `buildMtiJoins`), `mapPolymorphicRow` (`collection-runtime.ts:96`), `Collection.variant()`
  (`collection.ts:297`)
- Existing poly unit fixtures: `buildStiPolyContract` / `buildMixedPolyContract`
  (`packages/3-extensions/sql-orm-client/test/helpers.ts:190`, `:125`)
- ADRs: none — wires existing parent-side polymorphism machinery into the child path; no
  architectural shift.
