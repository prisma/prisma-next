# Brief: D6 — harden polymorphism.test.ts (whole-shape, implicit-default, de-raw)

## Task

Bring `test/integration/test/sql-orm-client/polymorphism.test.ts` (base / variant queries + variant
create) up to the `.agents/rules/sql-orm-client-whole-shape-assertions.mdc` standard, add explicit
top-level **implicit-default-selection** coverage for STI and MTI, and replace gratuitous raw SQL
reads with the ORM API.

Three threads:

1. **Whole-shape assertions.** Replace every `toMatchObject` / `toHaveProperty` / `not.toHaveProperty`
   / lone-`toBe` result assertion with a single whole-result `toEqual`. Order deterministically by a
   **base** column (`id`).
2. **Implicit-default-selection tests (STI + MTI), top level.** Add/repurpose tests that issue a
   query with **no `.select(...)`** and assert the *full default projected shape* with `toEqual` —
   for an STI variant row, for an MTI variant row, and for a base/all query returning the variant
   union. This is the deliberate "no-select → full default shape" exception the rule documents; name
   the tests for that property. (The existing "base query returns all variants" / "variant(Bug)" /
   "variant(Feature)" tests are the natural homes — make them assert the whole default shape.)
3. **De-raw.** Replace raw `runtime.query('select …')` **read-backs** that merely re-read data the
   ORM can return (e.g. `select type from tasks where id = …` after a create) with an ORM read +
   whole-shape `toEqual`. **KEEP** raw SQL that asserts a *storage-level invariant the ORM
   intentionally hides* — specifically the MTI-create test's check that **both** the base `tasks`
   row and the `features` variant row were written (the two-table transactional write). That storage
   assertion is legitimate; leave it raw and add a one-line comment saying why. Keep raw DDL
   (`create table`) and raw seed `insert`s (the patched-contract cast pattern makes ORM seeding
   awkward) — those are not "for no reason".

## Scope

**In:** `test/integration/test/sql-orm-client/polymorphism.test.ts` only (plus its local helpers if
needed). Test-only.

**Out:** `packages/**/src` (no production change). `polymorphism-include.test.ts` (that's D7). Do NOT
attempt to make explicit `.select(...)` restrict variant columns — that's the **TML-2783** bug;
don't write a test asserting the post-fix select behavior. If you use `.select(...)` anywhere on a
poly query and the variant column leaks in, that's TML-2783 — either assert the actual (leaky) shape
with a `// TML-2783` comment, or prefer the implicit-default shape instead.

## Completed when

- [ ] No `toMatchObject` / `toHaveProperty` / `not.toHaveProperty` remain as primary result assertions; results asserted with whole-shape `toEqual`, deterministically ordered by `id`.
- [ ] STI and MTI implicit-default-selection tests exist (no `.select`), asserting the full default shape.
- [ ] Gratuitous raw read-backs replaced with ORM reads; the MTI two-table storage assertion kept (with a why-comment); DDL + seeds left raw.
- [ ] Validation gate green.

## Standing instruction

Stay focused; test-only. Reference `TML-2783` where the variant-column-select-leak is relevant rather
than working around it silently. If a raw query turns out to assert something the ORM genuinely can't
express, keep it and say so.

## References

- Rule: `.agents/rules/sql-orm-client-whole-shape-assertions.mdc` (incl. the implicit-default exception).
- TML-2783 (explicit select doesn't restrict poly variant columns) — don't assert its post-fix behavior.
- Sibling pattern already refactored: `polymorphism-include.test.ts` (whole-shape + select + base-`id` orderBy).
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** opus.
- **Validation gate (run once):**
  - `pnpm --filter @prisma-next/integration-tests exec vitest run test/sql-orm-client/polymorphism.test.ts`
  - `pnpm --filter @prisma-next/integration-tests typecheck`
  - `pnpm --filter @prisma-next/integration-tests exec biome check test/sql-orm-client/polymorphism.test.ts`
- **Halt conditions:** a test can only pass by asserting TML-2783's buggy select behavior as if correct (surface instead); production change needed; diff strays into `src`.
- **Commit hygiene:** explicit staging; never push.
