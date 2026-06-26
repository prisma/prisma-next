# PSL: Directional Relation Syntax — Plan

**Spec:** `projects/psl-relation-syntax/spec.md`
**Linear Project:** [PSL: Directional Relation Syntax](https://linear.app/prisma-company/project/psl-directional-relation-syntax-04e6440a8ee4) (planning anchor: [TML-2939](https://linear.app/prisma-company/issue/TML-2939))

## At a glance

A **3-slice core stack** delivers the directional vocabulary proper (`from`/`to` foundation → explicit `through:` → pointer-disambiguation that retires `@relation(name:)`). A **2-slice parallel group** (implicit M:N, arrow-path) builds on the explicit-`through:` hand-off and is **flagged for promotion to a sibling follow-on project** — see [§ Project-boundary note](#project-boundary-note).

## Composition

### Stack (deliver in order)

1. **Slice `01-from-to-fk-foundation`** — Linear: [TML-2940](https://linear.app/prisma-company/issue/TML-2940)
   - **Outcome:** `@relation(from:, to:)` authors every FK (1:N / N:1) the legacy `fields:`/`references:` could; legacy parses as an input alias to the same IR; `prisma-next format` and `contract infer` emit canonical; legacy and canonical lower to byte-identical contracts.
   - **Builds on:** None (the `@relation` attribute grammar is already generic — no parser change).
   - **Hands to:** (a) the resolver reading `from`/`to` with legacy aliasing; (b) the CST `format` keyword-only normalize pass + the AST printer emitting canonical; (c) the backward-compat-equivalence test harness the M:N slices reuse.
   - **Focus:** `contract-psl/psl-relation-resolution.ts` (read `from`/`to`), `psl-parser/format/` (normalize pass, D3), `psl-printer` (canonical render), validation. FK relations only — no `through:`/`inverse:`/M:N here.

2. **Slice `02-through-explicit-mn`** — Linear: [TML-2941](https://linear.app/prisma-company/issue/TML-2941)
   - **Outcome:** an unambiguous M:N authored with `through: Junction` on one navigable end lowers to the existing `N:M` + `through` contract shape; the inverse list field is inferred by type-match (D4).
   - **Builds on:** Slice 1's `from`/`to` resolver + canonical-emit + equivalence harness.
   - **Hands to:** the `through:`-declared junction lowering (the surface slices 3–5 extend).
   - **Focus:** `psl-relation-resolution.ts` junction recognition via explicit `through:`; canonical emit of `through:`; runtime-parity fixture through the ORM. No disambiguation, no synthesis.

3. **Slice `03-pointer-disambiguation`** — Linear: [TML-2942](https://linear.app/prisma-company/issue/TML-2942)
   - **Outcome:** ambiguous M:N (self-relation / multiple between the same models) disambiguates via `through: Junction.relationField` on both ends; a 1:N back-relation with multiple candidates via `inverse: <fkField>`; `@relation(name:)` is absent from canonical output (parsed on input, never emitted).
   - **Builds on:** Slice 2's `through:` lowering.
   - **Hands to:** the complete point-don't-name disambiguation surface; `name:`-free canonical output.
   - **Focus:** `psl-relation-resolution.ts` disambiguation (replace the name-matching arms), `inverse:` for 1:N back-relations, grep gate + round-trip proving `name:` isn't emitted. D2, D4.

### Parallel group (builds on slice 2; **promotion candidates** — see boundary note)

- **Slice `04-implicit-mn-synthesis`** — Linear: [TML-2943](https://linear.app/prisma-company/issue/TML-2943)
  - **Outcome:** both navigable ends bare **and** no junction model linking them → the framework synthesises a model-less junction table + its `N:M`/`through` relations into the contract; postgres + sqlite emit its DDL. Slice-5 recognition (both bare + a junction model exists) is preserved (D5).
  - **Builds on:** Slice 2's `through:` lowering (synthesis lowers to the same shape with a conjured junction).
  - **Hands to:** implicit M:N parity with Prisma.
  - **Focus:** `contract-ts/build-contract.ts` + `psl-relation-resolution.ts` synthesis path; migration/DDL threading for the synthesised table; runtime-parity fixture. **Distinct blast radius — touches the migration subsystem.**

- **Slice `05-arrow-path-through`** — Linear: [TML-2944](https://linear.app/prisma-company/issue/TML-2944)
  - **Outcome:** an M:N authored on the terminal models via the arrow-path (`through: a -> J.b -> J.c -> T.d`), with the junction model present but carrying no relation fields, lowers to `N:M` + `through`.
  - **Builds on:** Slice 2's `through:` lowering (and slice 3 where the arrow-path is itself ambiguous).
  - **Hands to:** junction-relation-field-free M:N authoring.
  - **Focus:** arrow-path tokenisation + validation, lowering to `through`; runtime-parity fixture. Grammar exact form settled at slice spec.

## Dependencies (external)

- [x] Sibling slice 5 (PSL M:N recognition, TML-2794) merged on `main` — slice 2 extends its junction recognition; slice 4 must preserve its bare-list behaviour.
- [x] Sibling slice 0 (`through` contract shape + validator, TML-2784) merged — the lowering target for slices 2–5.
- [ ] Sibling slice 7 / TML-2933 (non-id unique junction targets) — independent; not a blocker. Touches the same `targetColumns` derivation, so coordinate rebases if both are in flight.

## Sequencing rationale

Slice 1 is a hard gate: until `from`/`to` resolve and the formatter/printer emit canonical, no slice has a foundation to author `through:`/`inverse:` over. Slices 2 → 3 stack by data dependency (3's disambiguation extends 2's recognition). Slices 4 and 5 both consume slice 2's `through:` lowering and touch disjoint surfaces (4: synthesis + migration; 5: arrow-path grammar), so they parallelise; 5 has a soft dependency on 3 only where an arrow-path is itself ambiguous.

### Project-boundary note

The plan lists **5 slices**, above the 1–4 sweet spot (`drive/calibration/sizing.md` flags 5+ as "two projects with one shared umbrella ticket"). The split is real: slices 1–3 deliver the project's named purpose (the directional, point-don't-name vocabulary) and stand alone; slices 4–5 are *additional* M:N boilerplate-elimination forms, and slice 4 reaches into the migration/DDL subsystem — a different blast radius.

**Decision (operator, 2026-06-24):** slices 4–5 are **kept in this project** — not promoted. The project delivers all five slices in one branch stack. (The promotion option was surfaced at the core's near-close per the 1–4 sweet-spot flag; the operator chose to keep them here.) S4 and S5 build on slice 2's `through:` foundation (and S5 on S3's member-access grammar); they parallelise after their dependencies.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/psl-relation-syntax/spec.md`
- [ ] ADR authored (directional relation vocabulary + `name:` retirement + implicit-junction synthesis)
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/psl-relation-syntax/**`
- [ ] Delete `projects/psl-relation-syntax/`
