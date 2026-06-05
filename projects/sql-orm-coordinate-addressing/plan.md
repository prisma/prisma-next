# Project plan — sql-orm-client coordinate addressing

Three slices, one PR each. S1 → S2 are sequential (S2's poly-include road depends on S1's
template types); S3 follows S2 (it retires the front-door pin, which requires S1+S2's consumers to
be coordinate-clean). No intra-project parallelism: all three slices contend on
`collection-contract.ts` and the fixture surface — serializing avoids rebase churn for no real
wall-clock loss.

### Slice 1 — Polymorphism resolution onto coordinates *(origin ticket TML-2841)*

- **Outcome:** the poly resolution layer addresses bases/variants by coordinate:
  `PolymorphismInfo`/`PolymorphismVariantInfo`/`VariantColumnRef` carry `{namespace, table}` object
  refs; `resolvePolymorphismInfo` resolves via `resolveDomainModel` (not `modelsOf`); the
  field/column + merged-map caches key on coordinates; `buildMtiJoins`, `mapPolymorphicRow`,
  `.variant()`, and the variant-aware predicate accessor consume the qualified refs (feeding
  `tableSourceForContract`'s existing namespace parameter). A cross-namespace poly fixture
  (variant table in a second namespace) passes at the resolution-layer + query-plan level.
- **Builds on:** the survey (ADR 221 helpers exist; contract IR already qualified).
- **Hands to:** the template types + coordinate-cache pattern the rest of the module conforms to;
  poly resolution correct for any namespace layout.
- **Focus:** `collection-contract.ts` (poly functions + their caches), `collection-runtime.ts`
  (`getMergedColumnToFieldMap` key, `mapPolymorphicRow`), `query-plan-select.ts` (`buildMtiJoins`
  + child poly joins), `collection.ts` `.variant()`, `model-accessor.ts` variant refs. **Not**
  relation resolution (`rel.to.namespace`, S2) and **not** the `modelsOf` front door (S3) — the
  poly path stops *calling* `modelsOf` but the function stays for non-poly callers. Alias scheme:
  keep `variant_table__column` but assert collision-correctness; qualify only if a test forces it.

### Slice 2 — Relation & include road honors target namespaces

- **Outcome:** `resolveModelRelations`/`resolveIncludeRelation` carry `rel.to.namespace` through
  (model + table resolution by coordinate); the include child-SELECT source, join columns, and
  decode path resolve the related model by coordinate — so a `.include()` whose target (poly or
  not) lives in another namespace works end-to-end, including the headline cross-namespace
  polymorphic include. PGlite integration fixture with a cross-namespace relation + cross-namespace
  poly include.
- **Builds on:** S1's template types + qualified poly layer.
- **Hands to:** the read path (root → include → poly) fully coordinate-addressed.
- **Focus:** `collection-contract.ts` relation resolution, `query-plan-select.ts` include builders'
  source/correlation resolution, `collection-dispatch.ts` decode lookups, integration fixture.
  **Not** mutations, accessors beyond what includes touch, or the front door.

### Slice 3 — Retire the front door; sweep the remainder

- **Outcome:** `modelsOf()`/`domainModelsAtDefaultNamespace` are gone from the module; remaining
  bare-name surfaces (mutation paths incl. the MTI two-table write, orderBy/where accessor lookups
  not covered by S1, group-by/aggregates, any straggler caches) resolve by coordinate; a grep gate
  (`domainModelsAtDefaultNamespace|modelsOf\(` and bare `ColumnRef.of(<literal table>` patterns)
  is recorded green. Full multi-namespace integration pass: reads + mutations + includes + variant
  flows against a ≥2-namespace contract.
- **Builds on:** S1 + S2 (their consumers are clean, so removing the throwing guard is safe).
- **Hands to:** project DoD.
- **Focus:** the sweep + the project-DoD integration fixture. Surface (don't absorb) any
  interpreter-side gaps the multi-namespace mutation tests expose (materializer bare lookups →
  follow-up ticket per spec non-goals).

## Tracker mapping

- S1 = **TML-2841** (origin ticket; text already matches).
- S2, S3 = sibling tickets in May WS2, related to TML-2841 (no sub-issues per house rule) — filed
  at project kickoff.

## Risks / open items

- The `modelsOf` throw is load-bearing today (honest failure for multi-namespace contracts);
  retiring it early would trade a loud error for silent mis-resolution — hence it lives in S3, last.
- Alias collisions (`variant_table__column` with same-named tables in two namespaces): S1 must make
  this *correct or loudly rejected*; pretty diagnostics are out of scope (spec non-goals).
- Interpreter materializers' bare `nodeByModel` lookups limit fixtures to unique model names across
  namespaces; acceptable for this project, follow-up if S3's tests need more.
