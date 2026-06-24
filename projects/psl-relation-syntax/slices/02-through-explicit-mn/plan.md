# Slice 2 — `through:` explicit M:N — Dispatch plan

**Slice spec:** `projects/psl-relation-syntax/slices/02-through-explicit-mn/spec.md`
**Linear:** [TML-2941](https://linear.app/prisma-company/issue/TML-2941)

Two sequential dispatches: lower the explicit `through:`, then prove it drives the runtime.

## M1 — Resolver parses `through:` + recognises the explicit named junction

- **Outcome:** `tags Tag[] @relation(through: PostTag)` lowers to the same `N:M` + `through` contract as the bare-list convention form; a `through:` naming a non-junction model yields an actionable diagnostic.
- **Builds on:** slice 1's `from`/`to` arg parsing (the allow-list it extends).
- **Hands to:** the explicit-`through:` recognition surface S3 extends for disambiguation.
- **Focus:** `contract-psl/src/psl-relation-resolution.ts` — add `through` to the relation arg allow-list; `parseRelationAttribute` reads a bare model name into `ParsedRelationAttribute.through`; in the backrelation-list resolution, when `through:` is present, recognise via the named junction (reuse `idColumnsAreExactlyFkPair` + `childColumnsInTargetIdOrder`; reuse the near-miss reasons for the diagnostic). Keep the bare-list `findJunctionFkPairs` path intact.
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/sql-contract-psl test` green with: an equivalence test (explicit-`through:` ≡ bare-list lower to the same `N:M`+`through` contract via `toEqual` on the emitted `Contract`); a diagnostic test (`through:` → non-junction model).
  - [ ] `cd packages/2-sql/2-authoring/contract-psl && pnpm typecheck` + `pnpm --filter @prisma-next/sql-contract-psl lint` clean.
- **Halt conditions:**
  - A bare `through:` turns out to be ambiguous (self-rel / multiple M:N) — do **not** silently pick; that is S3. Defer with a diagnostic or leave for S3 per the spec edge case, and note it.
  - The qualified `through: Model.field` form is encountered — out of scope (S3 + member-access grammar); decline cleanly.

## M2 — Runtime parity: PSL-`through:`-authored M:N drives the ORM

- **Outcome:** an emitted fixture authored with `@relation(through: …)` exercises `include` through the sql-orm-client ORM (PG + SQLite), returning the related rows.
- **Builds on:** M1's contract (the `N:M`+`through` shape) — already consumed by the sibling's M:N runtime, so no runtime change.
- **Hands to:** demonstrated PSL-`through:` → ORM parity (the slice's runtime DoD).
- **Focus:** extend/author a PSL fixture (mirror the sibling's `mn-psl` fixture) authored with explicit `through:`; wire it through the emit pipeline; an integration test asserting whole-row `include` results with an explicit `select` and ≥1 implicit (project standard). Rebuild dist before integration tests.
- **Completed when:**
  - [ ] The M:N `include` integration test passes on the PGlite + SQLite harness.
  - [ ] `pnpm fixtures:check` clean (regen via the emit path; no unintended contract drift).
- **Halt conditions:**
  - The runtime does **not** drive the `through:`-authored contract (a contract-shape mismatch vs the sibling's expected `through` shape) → halt; the lowering (M1) is wrong, not the runtime.

## Hand-off completeness

M1 (explicit-`through:` lowers to `N:M`+`through`) + M2 (that contract drives the ORM) compose to the slice-DoD: explicit-`through:` authors a navigable M:N with runtime parity, and the non-junction diagnostic fires. Disambiguation is explicitly S3.
