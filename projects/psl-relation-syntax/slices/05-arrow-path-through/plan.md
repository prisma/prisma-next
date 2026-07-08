# Slice 5 — arrow-path `through:` — Dispatch plan

**Slice spec:** `projects/psl-relation-syntax/slices/05-arrow-path-through/spec.md`
**Linear:** [TML-2944](https://linear.app/prisma-company/issue/TML-2944)

Two dispatches: parse + column-based recognition, then runtime parity.

## M1 — Arrow-path parse + column-based `through` recognition

- **Outcome:** an M:N authored with the arrow-path over a relation-field-less junction lowers to `N:M` + a `through` descriptor built from the path-named columns; diagnostics fire on malformed paths.
- **Builds on:** slice 2's `through`-descriptor machinery + slice 3's member-access grammar.
- **Hands to:** the arrow-path M:N contract the runtime consumes.
- **Focus:** **first pick the value form (decision #9):** try an unquoted `->` arrow grammar in `psl-parser` (read `parse.ts` arg-value + the tokenizer for a `->`/arrow token); if it's not clean within slice scope, use a **quoted-string** value (no grammar change) and split in the resolver. Report which. Then, in `contract-psl`, parse the 4-segment path (`localKey -> J.near -> J.far -> targetKey`), validate the columns/models, and build the `through` descriptor directly (reuse the slice-2 node machinery; the junction is a declared model). Diagnostics: malformed path; missing column; junction columns on different models; junction not a model.
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/sql-contract-psl test` (+ `psl-parser` if the grammar route is taken) green with: an arrow-path lowering test (`toEqual` on `Contract` + `validateSqlContractFully`) over a relation-field-less junction; the diagnostics (malformed / missing-column / cross-model-junction-cols).
  - [ ] `typecheck` + `lint` clean for touched packages.
- **Halt conditions:**
  - Neither the unquoted grammar nor a quoted-string fallback can carry the path cleanly → surface (re-scope the value form with the operator).
  - The column-based `through` can't be built without relation fields (e.g. a hard dependency on `findJunctionFkPairs`' relation-field assumptions) → surface.

## M2 — Runtime parity

- **Outcome:** `db.orm.<Model>.include(<m2n>)` over an arrow-path M:N returns the related rows.
- **Builds on:** M1's contract (same `through` shape the runtime already consumes).
- **Hands to:** arrow-path parity (the slice's runtime DoD) — and the project's final integration surface.
- **Focus:** a PSL fixture with an arrow-path M:N over a relation-field-less junction; emit; `include` integration test (whole-row, ≥1 implicit; PGlite). `pnpm build` first. `fixtures:check`.
- **Completed when:**
  - [ ] The arrow-path `include` integration test passes (PGlite).
  - [ ] `pnpm fixtures:check` clean (after `pnpm build`).
- **Halt conditions:**
  - The arrow-path contract doesn't drive the runtime (shape mismatch) → surface (M1 lowering wrong, not runtime).

## Hand-off completeness

M1 (arrow-path lowers to `through`) + M2 (it drives the ORM) compose to the slice-DoD: the arrow-path authors a navigable M:N over a relation-field-less junction, runtime-proven. This is the project's final slice.
