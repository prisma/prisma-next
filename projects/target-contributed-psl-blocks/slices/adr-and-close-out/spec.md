# Slice: adr-and-close-out

_Parent project: `projects/target-contributed-psl-blocks/`. Outcome: the architecture record matches the substrate as shipped, and the transient project workspace is torn down._

## At a glance

Markdown-only. Rewrite ADR 126 to the declarative descriptor SPI that Slices 1–3 actually shipped, land a three-layer-extensibility ADR (IR / lowering / declarative parse+print, tied by `discriminator`), fix the one-line `AGENTS.md` doc-bug, then close the project out (delete `projects/target-contributed-psl-blocks/`, scrub references, run the mandatory retro).

## Chosen design

Four deliverables, all docs:

1. **Revise `docs/architecture docs/adrs/ADR 126 - PSL top-level block SPI.md`.** Drop the "Under revision" banner. Replace the `parseFn`/`validateFn`/`emitFn` function-SPI Decision/Details with the as-shipped declarative design: an extension registers an `AuthoringPslBlockDescriptor` (keyword, name, typed parameters `ref`/`value`/`option`/`list`); the framework owns one generic parser, validator, and printer; `value` rides the codec JSON medium; `option` is an authoring-time token constraint, not a domain enum. Examples must reflect real APIs (per `adr-examples-must-match-code`).

2. **Land a three-layer-extensibility ADR** — a new ADR file (next free number) recording how the three layers carry a contributed entity kind, tied together by its `discriminator`: contract/Schema IR class (three-layer-polymorphic-IR) → lowering via the `entityTypes` factory → declarative parse+print of the PSL block. Reference the existing pattern docs (`three-layer-polymorphic-ir.md`, `frozen-class-ast.md`) and ADR 224 (entries coordinate). Subsystem docs under `docs/architecture docs/subsystems/` that describe the PSL/contract path gain a pointer to it.

3. **Fix `AGENTS.md` line 96** — `AuthoringContributions.entities` → `AuthoringContributions.entityTypes` (the field that actually exists).

4. **Close out** via `drive-close-project`: verify project DoD across all four slices, run the mandatory retro, migrate any long-lived methodology into `docs/`, delete `projects/target-contributed-psl-blocks/`, and scrub repo-wide references to it.

## Coherence rationale

One reviewer sitting: every change records the same already-merged substrate (Slices 1–3) in the architecture docs, then removes the scaffolding that described building it. Deliverables 1–3 are the doc PR; deliverable 4 (teardown) runs last, after the docs land, and may be its own close-out PR per `drive-close-project`.

## Scope

**In:** ADR 126 rewrite; new three-layer-extensibility ADR; subsystem-doc pointers to it; the one-line `AGENTS.md` fix; project close-out (retro, doc migration, project-dir deletion, reference scrub).

**Out:** Any code change (this slice is markdown-only — if a doc claim can't be made true without code, that's a separate slice/bug, not this). The escape-hatch for non-declarative blocks (no consumer). Real RLS (downstream). The pre-existing duplicate-`ADR 224` filename collision is not this slice's to resolve.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| New ADR number selection | Pick the next unused number; two files already share `ADR 224`, so scan filenames, don't assume max+1 is free | Verify against `docs/architecture docs/adrs/` at dispatch time |
| `projects/…` references outside the project dir | Scrub before deleting | `drive-close-project` owns the grep; spec/plan cross-links from sibling slices and any `docs/` mentions must be repointed or removed |

## Slice-specific done conditions

- [ ] ADR 126 reads as a settled record of the declarative SPI (no "under revision" banner); the three-layer ADR exists and is referenced from the relevant subsystem doc(s); `AGENTS.md` says `entityTypes`. (This is project-DoD item 11; the close-out itself is gated by `drive-close-project`'s own DoD.)

## Open Questions

1. Three-layer extensibility as a standalone ADR vs a section appended to an existing ADR/pattern doc? Working position: standalone ADR (next free number), cross-linked from the pattern docs and subsystem docs — it's a decision record, not a how-to.

## References

- Parent project: `projects/target-contributed-psl-blocks/spec.md` (DoD item 11)
- Linear issue: [TML-2806](https://linear.app/prisma-company/issue/TML-2806)
- ADRs: `ADR 126 - PSL top-level block SPI` (revise); `ADR 224 - Namespace concretions address entities by coordinate` (entries); patterns `three-layer-polymorphic-ir.md`, `frozen-class-ast.md`, `json-canonical-class-in-memory.md`
- Merged slices: #753 (Slice 1), #754 (Slice 2), #757 (Slice 3)
