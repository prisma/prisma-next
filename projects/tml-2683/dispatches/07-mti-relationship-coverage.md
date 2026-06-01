# Brief: D7 — MTI+relationship coverage gaps + relationship implicit-default

## Task

Close the MTI+relationship integration-coverage gaps identified during D4/D5, and add relationship-level
**implicit-default-selection** coverage. All in the integration suite
(`test/integration/test/sql-orm-client/`), whole-shape `toEqual`, base-column ordering, per the
`.agents/rules/sql-orm-client-whole-shape-assertions.mdc` standard.

New scenarios to cover (add the minimal local fixtures each needs — keep fixtures **local** to the
test file as `build*IncludeContract` helpers, per the standalone-fixture pattern; do NOT widen the
shared `helpers.ts` builders):

1. **MTI model as the include PARENT** — a polymorphic (MTI) model that is the *root* of an include
   (it has a relation to some child). Confirms parent-side correlation works when the parent itself
   spans base + variant tables.
2. **To-one / N:1 include whose TARGET is a poly model** — current coverage is all 1:N. Confirms
   per-row variant mapping on a single included object (not an array).
3. **A base with 2+ MTI variant tables** — current `Task` has one MTI variant (`Feature`). Add a
   second MTI variant and confirm only the matching variant table's columns appear per row (no
   cross-variant column contamination).
4. **Nested include through a poly target** — `Parent → tasks (poly) → grandchild`. Confirms a
   relation hanging off the poly child stitches correctly when the child row is variant-mapped.

Plus:

5. **Relationship-level implicit-default tests (STI + MTI).** `.include('<polyRel>')` with **no
   `.select(...)`** asserting the *full default variant shape* per child row (admin rows carry `role`,
   regular carry `plan`; bug rows carry `severity`, feature rows carry `priority`). The deliberate
   no-select → full-default-shape exception in the rule.

6. **TML-2783 cross-reference.** Add a `// TML-2783` comment to the existing select-based MTI
   assertion in `polymorphism-include.test.ts` (where `priority` surfaces despite a base-only
   `.select(...)`), so the known leak is traceable.

## Scope

**In:** `test/integration/test/sql-orm-client/polymorphism-include.test.ts` (extend) and/or a new
sibling test file + local fixtures. Test-only.

**Out:** `packages/**/src` (no production change). Do not assert TML-2783's post-fix select behavior;
prefer implicit-default shapes for poly result assertions, or assert the actual current shape with a
`// TML-2783` note. Don't widen `helpers.ts` shared builders (breaks sibling DDL).

## Completed when

- [ ] Tests for scenarios 1–4 exist and pass on PGlite, each asserting the whole result with `toEqual`, ordered by base `id`.
- [ ] Relationship-level STI + MTI implicit-default tests exist (no `.select`), asserting full default per-variant shape.
- [ ] The existing poly-include select-leak assertion carries a `// TML-2783` reference.
- [ ] Validation gate green.

## Standing instruction

Stay focused; test-only. If any new scenario surfaces a real production defect (not a fixture/seed
mistake), HALT and surface it with evidence + the likely owning area — do not patch `src`. If a
scenario needs a fixture shape the cast-interface pattern can't express cleanly, surface the friction
rather than contorting the test.

## References

- D4/D5 gap list: `projects/tml-2683/reviews/code-review.md` round notes + the D4 implementer's coverage assessment.
- Existing patterns: `polymorphism-include.test.ts` (local `build*IncludeContract` fixtures, DDL, seeds, cast interfaces, base-`id` orderBy, whole-shape `toEqual`).
- Rule: `.agents/rules/sql-orm-client-whole-shape-assertions.mdc`.
- TML-2783 (select-vs-variant-columns) and TML-2782 (orderBy-vs-MTI-variant) — don't trip these; order by base columns only.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** opus.
- **Validation gate (run once — report exact commands):**
  - the new/extended test file(s) on PGlite via `pnpm --filter @prisma-next/integration-tests exec vitest run <path>`
  - `pnpm --filter @prisma-next/integration-tests typecheck`
  - `pnpm --filter @prisma-next/integration-tests exec biome check <files>`
  - confirm sibling `polymorphism*.test.ts` still pass
- **Halt conditions:** a scenario reveals a real `src` defect (surface, don't patch); a fixture can't be expressed via the cast pattern; diff strays into `src`.
- **Commit hygiene:** explicit staging; never push.
