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

## D3 (execution-time, post-D4 discovery) — MTI variant-field `where`: **fix in this slice**

**Discovery:** D4 integration testing found that a variant-specific `where` on an **MTI** poly
include throws at runtime — `db.orm.Project.include('tasks', t => t.variant('Feature').where(x => x.priority.gte(3)))`
→ `TypeError: Cannot read properties of undefined (reading 'gte')`. Root cause: `.variant()`
(`collection.ts:296`) keeps the base `modelName` and only sets `state.variantName`; the predicate
accessor `createModelAccessor(context, modelName)` (`model-accessor.ts:40`) resolves columns via the
**base** table only (`resolveColumn(contract, baseTable, …)`), so an MTI variant column (which lives
on a joined variant table) is `undefined`. STI variant columns live on the base table → they resolve
→ the STI variant-`where` case works and is tested. So the spec's original AC-3 framing ("falls out
of the joins") holds for STI but **not** MTI.

**Decision (operator):** fix it in this slice — adds dispatch **D5**. Make the predicate accessor
variant-aware: when a variant is selected, merge that variant's columns and qualify their `ColumnRef`
against the variant table D1 already joins into the child SELECT. The merged field→column map already
exists for the mutation path (`collection.ts` ~`:1274`); reuse the pattern for `where`.

**Rejected:** defer MTI variant-field filtering to a follow-up ticket (scope AC-3 to STI). Smaller,
but leaves an asymmetry where STI variant-`where` works and MTI silently throws.

## D4 (execution-time, post-D4 discovery) — integration target: **PGlite-only; amend spec**

**Discovery:** the `sql-orm-client` integration suite is **Postgres/PGlite-only** (`runtime-helpers.ts`
imports only `postgres*`; `withDevDatabase` = PGlite) — not "both PGlite + SQLite" as the spec/plan
stated. SQLite ORM coverage lives in a separate e2e package (`test/e2e/framework/test/sqlite/`) whose
contract-builder has **no polymorphism support** (no `discriminator`/`variant`).

**Decision (operator):** accept **PGlite-only** integration coverage for this slice and amend the
"both targets" condition. Rationale: the emitted variant-join/projection lowering is target-agnostic,
so PGlite already exercises the D1–D3 logic; a SQLite leg would only re-confirm the sqlite renderer
handles an ordinary join. SQLite poly-include coverage is a **deferred follow-up**, itself gated on
teaching the sqlite contract-builder about polymorphism.

**Rejected:** build the SQLite harness now (largest scope; blocked on contract-builder polymorphism).

## D5b (execution-time, post-D7 discovery) — nested include through a poly target: **fix in this PR (D8)**

**Discovery:** D7's "nested include through a poly target" scenario (`Parent → tasks(poly) → reporter`)
silently decodes the grandchild to `null` for every row. Root cause: `decodeIncludePayload`
(`collection-dispatch.ts`) poly-maps the child row via `mapPolymorphicRow` **first**, then reads the
nested-include payload from the *mapped* row — but `mapPolymorphicRow` (`collection-runtime.ts:122-126`)
keeps only columns present in the variant model-field map, so the nested payload column (a relation
alias, not a model field) is dropped → `null`. The non-poly mapper (`mapStorageRowToModelFields:58`)
keeps unknown columns via fallback, which is why the non-poly nested path works. Same silent-degradation
class as TML-2683, one level deeper.

**Decision (operator):** fix in this PR — dispatch **D8**. Preferred fix: read each nested-include
payload from the **raw** child row (`childRow[nestedInclude.relationName]`) before poly-mapping, then
assign the decoded value onto the mapped row — leaving `mapPolymorphicRow`'s variant-shaping (which
must keep dropping sibling-variant columns) untouched. Unskip the D7 scenario-4 test. Regression guard:
sibling-variant columns must still be dropped per row.

**Rejected:** make `mapPolymorphicRow` keep all unknown columns — would re-break the per-variant shaping
D2 established (sibling-variant NULL columns would resurface).

## Non-blocking process note — stale `dist` masks the fix in integration

The integration package imports the **built `dist`** of `@prisma-next/sql-orm-client`, not `src`. A
stale `dist` makes the integration tests silently exercise pre-fix behavior. `pnpm test:integration`'s
`pretest` runs `pnpm -w build`, so the full gate is safe; a bare `vitest` filter run is **not** —
rebuild `@prisma-next/sql-orm-client` first.


## Non-blocking note — scalar reducers on polymorphic-target relations

TML-2683 observes that include scalar reducers (`count()` / `sum()` / …) on a poly-target
relation inherit the SQL-side gap (a `where` on a variant-specific column needs the variant
joins) but not the row-decode gap (they return a primitive). The scalar-reducer SQL is
emitted through the same `buildIncludeChildRowsSelect` family, so the variant joins added in
this slice's SQL-side dispatch cover the scalar `where` case automatically once the
include-aggregates slice (TML-2588 / TML-2595) lands. No extra scalar-specific dispatch is
needed here; called out in the spec's **Out** scope.
