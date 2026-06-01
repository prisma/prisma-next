# Design notes — TML-2683

Decisions settled before spec authoring (this slice is post-discussion). Alternatives
live here; the spec carries only the decided shape.

## D1 — `r => r.variant('X')` narrowing on a polymorphic include: **implement it**

**Decision:** mirror parent `Collection.variant()` at the include-refinement level. A
`.variant('X')` on a polymorphic include applies the discriminator filter (STI) **and**
inner-joins only the named variant table (MTI) inside the LATERAL / correlated child
subquery, and narrows the included relation's TypeScript value to that variant's row type.

**Why:** the runtime slot already exists — `IncludeExpr.nested` is a `CollectionState`,
which already carries `variantName` (`types.ts:75`). The include refinement callback
already receives a real `Collection` running in `includeRefinementMode`
(`collection.ts:434`), and `Collection.variant()` (`collection.ts:297`) already sets
`state.variantName` + the discriminator filter. The SQL parent path already reads
`state.variantName` to choose inner-vs-left join in `buildMtiJoins` (`query-plan-select.ts:1161-1166`),
and the parent decode path already passes it to `mapPolymorphicRow`. So narrowing at the
child level is mostly *wiring an existing mechanism through one more level* plus the
result-type narrowing — not a new subsystem. Rejecting it at the type level would be
roughly the same effort (a deliberate type-level block) for less capability.

**Rejected:** defer `.variant()` narrowing to a follow-up (fix only silent degradation +
variant-specific `where`). Cheaper, but leaves an obvious asymmetry with parent
`.variant()` and a half-wired `nested.variantName` slot that the SQL/decode paths would
read but no public API could set.

## D2 — Baseline: **plan against the post-2657 + post-2729 correlated-only tree**

**Decision:** the plan assumes both predecessors have landed:
[TML-2657](https://linear.app/prisma-company/issue/TML-2657) (multi-query include strategy
removed from the read path) and [TML-2729](https://linear.app/prisma-company/issue/TML-2729)
(LATERAL dropped from includes; all SQL targets emit correlated subqueries). The read path is
therefore a **single correlated include builder** — `buildCorrelatedIncludeProjection` sharing
a strategy-less `buildIncludeChildRowsSelect`. There is no multi-query stitcher and no lateral
builder to extend. We add the MTI variant joins/projection + the decode mapping to that single
path only.

**Why:** matches TML-2683's stated rationale ("don't extend two builder families when one is
being deleted"). 2657 has landed; 2729 is assumed landed per operator direction. The original
#619 blocker is resolved.

**Consequence to watch (from 2729's end-state):** 2729 removed `.withJoins(nestedJoins)` from
`buildIncludeChildRowsSelect` — nested includes are now projection-only correlated subqueries,
so the child SELECT has *no* join source. This slice re-introduces `.withJoins(...)` for the
MTI variant tables. That join (base⋈variant on PK, inside the correlated subquery's FROM) is
ordinary SQL, orthogonal to the LATERAL machinery 2729 removed. Must NOT touch the surfaces
2729 deliberately kept: `JoinAst.lateral`, the postgres renderer's LATERAL emission, the public
`lateralJoin()` DSL, and the `lateral` capability flag.

**Rejected:** keep a lateral path / strategy axis for this fix. Contradicts 2729.

## Non-blocking note — scalar reducers on polymorphic-target relations

TML-2683 observes that include scalar reducers (`count()` / `sum()` / …) on a poly-target
relation inherit the SQL-side gap (a `where` on a variant-specific column needs the variant
joins) but not the row-decode gap (they return a primitive). The scalar-reducer SQL is
emitted through the same `buildIncludeChildRowsSelect` family, so the variant joins added in
this slice's SQL-side dispatch cover the scalar `where` case automatically once the
include-aggregates slice (TML-2588 / TML-2595) lands. No extra scalar-specific dispatch is
needed here; called out in the spec's **Out** scope.
