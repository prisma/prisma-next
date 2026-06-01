# Brief: D1 — SQL side: emit polymorphism joins + projection in the child SELECT

## Task

In `packages/3-extensions/sql-orm-client/src/query-plan-select.ts`, teach the correlated
include child-SELECT builder about polymorphism. For a `.include()` whose **target (related)
model** is polymorphic, the child correlated subquery must resolve
`resolvePolymorphismInfo(contract, include.relatedModelName)` and, when MTI variants exist,
emit the `buildMtiJoins(...)` joins + `variant_table__column` projection **inside** the child
SELECT — choosing inner-join (named variant) vs left-join (all variants) from
`include.nested.variantName`, exactly as the parent path does in `compileSelectWithIncludes`.
The discriminator column and any STI variant-specific (base-table) columns must be projected so
the decoder (a later dispatch) can resolve each row's variant. This is the parent↔child
symmetry described in the slice spec's "Chosen design".

Baseline note: the branch is stacked on TML-2729 — the read path is **correlated-only**
(`buildCorrelatedIncludeProjection` is the sole include builder; there is no
`buildLateralIncludeArtifacts`, no `include-strategy.ts`, no `strategy` param). TML-2729 also
removed the child SELECT's `.withJoins(nestedJoins)` (nested includes are projection-only
correlated subqueries), so the child SELECT currently has **no join source** — this dispatch
re-introduces `.withJoins(...)` as the sole source, for the MTI variant tables. That variant
join (base ⋈ variant on PK, in the correlated subquery's FROM) is ordinary SQL, unrelated to
the LATERAL machinery 2729 removed.

## Scope

**In:**
- `query-plan-select.ts` — `buildIncludeChildRowsSelect` and `buildDistinctNonLeafChildRowsSelect`
  (both child-SELECT builders), reached via `buildCorrelatedIncludeProjection`. Add the
  polymorphism resolution + MTI joins/projection + discriminator/STI-variant-column projection.
- Self-relation correctness: when the base table is aliased (`childTableAlias` set), the
  `buildMtiJoins` join-`ON` references the unaliased base table name and will fall out of scope —
  apply the same alias remap the builder already applies to `orderBy`/`where`.
- `test/query-plan-select.test.ts` — **write the tests first**. Assert the correlated child
  SELECT's joins + projection for an STI-target include and an MTI-target include, the
  variant-narrowed inner join (`nested.variantName` set), and the self-relation alias remap.
  Use/extend `buildStiPolyContract` / `buildMixedPolyContract` from `test/helpers.ts`; if those
  contracts lack a parent→poly relation, add one.

**Out:**
- `decodeIncludePayload` / any decode-side change (that is D2 — rows may still be base-mapped
  at runtime after this dispatch; you are only making the data *available* in the SQL).
- The `.variant()` public refinement API surface / result-type narrowing (that is D3). You may
  read `include.nested.variantName` here, but do not add the `.variant()` operator to the
  refinement collection type.
- Integration tests / new DB fixtures (that is D4). Unit-level query-plan assertions only.
- Anything 2729 deliberately keeps: `JoinAst.lateral`, the postgres LATERAL renderer, the
  public `lateralJoin()` DSL, the `lateral` capability flag.

## Completed when

- [ ] For an MTI-target `.include()`, the emitted child correlated SELECT joins the variant
      table(s) and projects their columns under `variant_table__column` aliases.
- [ ] For an STI-target `.include()`, the child SELECT projects the discriminator column and the
      variant-specific base-table columns.
- [ ] `include.nested.variantName`, when set, produces an inner join to only that variant (STI:
      discriminator filter already present via the refinement's `where`); when unset, left-joins
      all MTI variants.
- [ ] New `test/query-plan-select.test.ts` cases (written before the implementation) cover STI
      target, MTI target, variant-narrowed, and self-relation alias remap — and pass.
- [ ] Validation gate green (below).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal
go in the same dispatch with a one-line note in your wrap-up. Anything that pulls you off the
goal — especially touching the decode path, the `.variant()` type surface, or any 2729-kept
lateral surface — halts and surfaces to the orchestrator.

## References

- Slice spec: `projects/tml-2683/spec.md` — chosen design (parent↔child symmetry), scope, edge cases.
- Slice plan: `projects/tml-2683/plan.md` § Dispatch 1.
- Design notes: `projects/tml-2683/design-notes.md` — the 2729 `.withJoins` consequence + must-not-touch list.
- Parent-side template to mirror: `compileSelectWithIncludes` and `buildMtiJoins` in `query-plan-select.ts`.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md` (commit hygiene, tests-first, heartbeats, no transient IDs in code).

## Operational metadata

- **Model tier:** orchestrator-grade (opus) — subtle typed query-AST work with a self-relation alias trap.
- **Validation gate (run once, at end):**
  - `pnpm --filter @prisma-next/sql-orm-client typecheck`
  - `pnpm --filter @prisma-next/sql-orm-client test`
  - `pnpm lint:deps`
- **Halt conditions:** the decode path must be touched to make a unit test pass (means the test is mis-scoped — surface); a 2729-kept lateral surface needs changing; an assumption in the spec is observed false (e.g. `buildMtiJoins` can't be reused inside a correlated subquery); diff exceeds ~12 files.
- **Heartbeats:** write `wip/heartbeats/implementer.txt` per the persona cadence.
- **Commit hygiene:** explicit staging; tests-first commit then implementation commit is ideal; never push.
