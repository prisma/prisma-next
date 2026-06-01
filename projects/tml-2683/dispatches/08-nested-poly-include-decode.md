# Brief: D8 — fix nested include through a polymorphic target (depth-2 decode)

## Task

Fix the depth-2 silent-degradation bug D7 surfaced: a nested `.include(...)` hanging off a
**polymorphic** include target decodes to `null` for every row. In
`decodeIncludePayload` (`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`), the poly
branch maps the child row via `mapPolymorphicRow` first, then reads each nested-include payload from
the **mapped** row (`mapped[nestedInclude.relationName]`). But `mapPolymorphicRow`
(`collection-runtime.ts:96-128`) keeps only columns present in the variant model-field map, so the
nested payload column (a relation alias, not a model field) is dropped → the grandchild decodes to
`null`. The non-poly mapper preserves unknown columns via fallback, so the non-poly nested path works.

**Preferred fix:** read each nested-include payload from the **raw** child row
(`childRow[nestedInclude.relationName]`), decode it, and assign the decoded value onto the mapped row
(`mapped[nestedInclude.relationName]`). This works for both poly and non-poly (the raw row always
carries the payload under its relation alias) and leaves `mapPolymorphicRow`'s variant-shaping
untouched. Do NOT make `mapPolymorphicRow` keep all unknown columns — that would resurrect the
sibling-variant NULL columns it is supposed to drop (re-breaking D2's per-variant shaping).

## Scope

**In:**
- `collection-dispatch.ts` `decodeIncludePayload` — source the nested payload from the raw child row.
- Tests-first: a unit test in `test/collection-dispatch.test.ts` for a poly child with a nested
  include — assert the grandchild decodes to its real value (not `null`) AND the parent poly row is
  still variant-shaped (sibling-variant columns still dropped). Cover both a variant with an MTI table
  and a variant without (the bug hit both).
- Unskip the D7 scenario-4 integration test (`it.skip` → `it`) in
  `test/integration/test/sql-orm-client/polymorphism-include-relationships.test.ts` and confirm it
  passes on PGlite with the correct stitched shape.

**Out:**
- `mapPolymorphicRow`'s variant-shaping logic (don't change how it drops sibling-variant columns).
- The SQL builder (`query-plan-select.ts`) — the nested correlated subquery is already emitted; this
  is decode-only.
- Anything beyond nested-include payload preservation.

## Completed when

- [ ] A nested include through a poly target decodes the grandchild to its real value (unit + the unskipped D7 integration test).
- [ ] Per-variant shaping is unchanged: sibling-variant columns are still dropped (regression guard, asserted).
- [ ] The previously-skipped D7 scenario-4 test is unskipped and passes on PGlite.
- [ ] Validation gate green.

## Standing instruction

Stay focused; minimal decode-only fix. Tests-first. The top risk is regressing per-variant shaping —
assert it explicitly. If the raw-row payload isn't actually available where expected, surface it
(would indicate a SQL-side gap) rather than reaching into `mapPolymorphicRow`.

## References

- Design notes: `projects/tml-2683/design-notes.md` § D5b (root cause + the chosen fix + the rejected alternative).
- D7 report + the `it.skip` scenario: `test/integration/test/sql-orm-client/polymorphism-include-relationships.test.ts`.
- D2 decode (what you're extending): `decodeIncludePayload` in `collection-dispatch.ts`; `mapPolymorphicRow` / `mapStorageRowToModelFields` in `collection-runtime.ts`.
- Rule for the integration test style: `.agents/rules/sql-orm-client-whole-shape-assertions.mdc`.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** opus.
- **Validation gate (run once — rebuild sql-orm-client before the integration run; the integration package imports `dist`):**
  - `pnpm --filter @prisma-next/sql-orm-client typecheck`
  - `pnpm --filter @prisma-next/sql-orm-client test`
  - `pnpm --filter @prisma-next/sql-orm-client build` then `pnpm --filter @prisma-next/integration-tests exec vitest run test/sql-orm-client/polymorphism-include-relationships.test.ts test/sql-orm-client/polymorphism-include.test.ts`
  - `pnpm lint:deps`
- **Halt conditions:** the fix requires changing `mapPolymorphicRow`'s shaping (means the raw-row approach didn't work — surface); per-variant shaping can't be preserved; the raw nested payload isn't present (SQL-side gap); diff exceeds ~6 files.
- **Commit hygiene:** explicit staging; tests-first; never push; no bare casts (use `blindCast`/`castAs` if needed).
