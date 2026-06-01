# Brief: D3 — `.variant()` narrowing surface on include refinements (type + wiring)

## Task

Make `db.orm.<parent>.include('<polyRel>', r => r.variant('X'))` a supported, correctly-typed
operation. After this dispatch: (a) `.variant('X')` is callable on the include-refinement
collection the `include(rel, r => …)` callback receives, for a polymorphic-target relation;
(b) it sets `nested.variantName = 'X'` on the include's nested state (so the already-wired SQL
side from D1 inner-joins only that variant and the decode side from D2 maps to it); and (c) the
**included relation's value type narrows** to variant `X`'s row type — mirroring how the parent
`Collection.variant('X')` narrows a root query's row type.

Runtime reality to confirm first: the refinement callback already receives a real `Collection`
constructed in `includeRefinementMode` (`collection.ts` ~`:434`), and `Collection.variant()`
(`collection.ts:297`) already sets `state.variantName` + the discriminator filter; that nested
state becomes `include.nested`. So the runtime path may already work — your job is principally the
**type surface**: confirm `.variant()` is actually exposed (and correctly typed) on the refinement
collection type, and that the result row type narrows. The open question the spec flags: is
`.variant()` present on `IncludeRefinementCollection` today, or stripped in refinement mode? Resolve
it by reading the types; then make the type surface + result narrowing correct.

## Scope

**In:**
- The include type machinery in `collection.ts` / `collection-internal-types.ts` / `types.ts`:
  `IncludeRefinementCollection`, `IncludeRefinementResult`, `IncludeRefinementValue` (and whatever
  maps a refinement's returned collection to the included relation's value type). Expose `.variant()`
  on the refinement collection for polymorphic targets and narrow the resulting relation value type
  to the chosen variant's row union member.
- Any minimal runtime wiring needed so `r.variant('X')` on the refinement actually lands
  `nested.variantName` on `include.nested` (verify D1/D2 consume it; if the refinement path already
  threads it, no runtime change is needed — say so).
- Type-level tests: extend `test/polymorphism.test-d.ts` (or add a `*.test-d.ts`) to assert
  `.include('<polyRel>')` without refinement yields the **variant union** row type, and
  `.include('<polyRel>', r => r.variant('X'))` narrows the relation value to variant `X`. Add a
  small runtime unit test that the refinement `.variant()` sets `nested.variantName` on the include.

**Out:**
- The SQL builder (`query-plan-select.ts`, D1) and the decoder (`collection-dispatch.ts`, D2) —
  both already read `nested.variantName`. Do not change their logic. If you find they *don't*
  actually consume it correctly for the refinement path, that's a halt-and-surface (D1/D2 gap), not
  a silent fix here.
- Integration / real-DB tests — D4.
- Mutation-path include typing.

## Completed when

- [ ] `.include('<polyRel>', r => r.variant('X'))` type-checks and the included relation value type
      is variant `X`'s row type (not the base/union).
- [ ] `.include('<polyRel>')` (no refinement) types the relation value as the variant union.
- [ ] `r.variant('X')` on the refinement sets `nested.variantName` (runtime unit test).
- [ ] New type-level tests (`*.test-d.ts`) assert both the union and the narrowed shapes and pass
      the package's type-test runner.
- [ ] Validation gate green (below) — including the type-test command.

## Standing instruction

Stay focused on the goal; control scope. Tests-first where it applies (type tests express the
contract — write them first, watch them fail/pass). The hardest part is type-level; if you find the
narrowing requires reshaping a widely-used type alias, surface the blast radius before committing.
Anything that pulls you into changing D1's SQL logic or D2's decode logic HALTS and surfaces.

## References

- Slice spec: `projects/tml-2683/spec.md` — chosen design (`.variant()` row of the design block) + Open Question #1 (is `.variant()` exposed on the refinement type today?).
- Slice plan: `projects/tml-2683/plan.md` § Dispatch 3.
- D1+D2 commits on this branch (`git log --oneline df99e8c7a..HEAD`) — the runtime that already reads `nested.variantName`.
- Parent-side precedent: `Collection.variant()` (`collection.ts:297`) — how it narrows the root row type; mirror its result-type mechanism at the include level.
- `test/polymorphism.test-d.ts` — existing type-test patterns for the poly mutation path.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** orchestrator-grade (opus) — type-level narrowing across the include result-type machinery; highest-judgment dispatch in the slice.
- **Validation gate (run once, at end):**
  - `pnpm --filter @prisma-next/sql-orm-client typecheck`
  - the package's type-test command for `*.test-d.ts` (discover from `package.json` / how `polymorphism.test-d.ts` is run — likely `vitest --typecheck` or a `test:types` script; confirm and report which)
  - `pnpm --filter @prisma-next/sql-orm-client test`
  - `pnpm lint:deps`
- **Halt conditions:** narrowing the include value type requires changing D1/D2 runtime logic; the refinement-path `nested.variantName` is NOT consumed by D1/D2 as assumed; the narrowing needs a breaking reshape of a type alias used outside the include surface; diff exceeds ~8 files.
- **Heartbeats:** `wip/heartbeats/implementer.txt`. **Commit hygiene:** explicit staging; never push; never amend without authorization.
