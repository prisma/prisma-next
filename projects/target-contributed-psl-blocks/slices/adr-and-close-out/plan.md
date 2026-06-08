# Slice `adr-and-close-out` — Dispatch Plan

**Slice spec:** [`./spec.md`](./spec.md) (Project-DoD item 11). **Linear:** [TML-2806](https://linear.app/prisma-company/issue/TML-2806). **Branch:** `tml-2806-slice-4-adr-and-close-out` (off `main`; Slices 1–3 merged).

**Model tiers:** implementer `sonnet`, reviewer `opus` (operator directive).

## Shape

Markdown-only. The four doc deliverables form one coherent outcome — *make the architecture record match the substrate Slices 1–3 shipped* — so they land in a single dispatch (D1): one implementer studies the merged design once and writes all of it; one reviewer holds the doc set in one sitting. The project teardown is **not** a dispatch — it runs through `drive-close-project` after D1 lands (it owns the retro, doc migration, project-dir deletion, and reference scrub, and opens its own close-out PR).

## Dispatches

### D1: record the declarative SPI + three-layer extensibility as shipped
- **Outcome:** the architecture docs describe what Slices 1–3 actually built.
  - `docs/architecture docs/adrs/ADR 126 - PSL top-level block SPI.md` — "Under revision" banner removed; Decision/Details rewritten from the `parseFn`/`validateFn`/`emitFn` function SPI to the declarative `AuthoringPslBlockDescriptor` (keyword, name, typed parameters `ref`/`value`/`option`/`list`); framework owns one generic parser/validator/printer; `value` rides the codec JSON medium; `option` is an authoring-time token constraint (not a domain enum). Examples copy/pasteable against the real exported APIs.
  - A new ADR **225** (`docs/architecture docs/adrs/ADR 225 - <title>.md`) records three-layer extensibility for a contributed entity kind, tied by its `discriminator`: contract/Schema IR class (three-layer-polymorphic-IR) → lowering via the `entityTypes` factory → declarative parse+print of the PSL block. Cross-links `three-layer-polymorphic-ir.md`, `frozen-class-ast.md`, and `ADR 224 - Namespace concretions address entities by coordinate`.
  - `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md` (and any other PSL/extension subsystem doc the grep surfaces) points at ADR 225.
  - `AGENTS.md` line ~96: `AuthoringContributions.entities` → `AuthoringContributions.entityTypes`.
- **Builds on:** Slices 1–3 (merged: #753 / #754 / #757). ADR 224 (entries); the pattern docs.
- **Hands to:** the slice-DoD doc state — ADR 126 settled, ADR 225 present and referenced, `AGENTS.md` fixed. Ready for `drive-close-project`.
- **Focus (JUDGMENT):** ADR 225's number is free (verify at dispatch — 223/224 are each duplicated, so confirm 225 is unused before claiming it); the two ADRs are decision records, not how-tos; examples must match real APIs (`adr-examples-must-match-code`); prose stays tight (no flowery restatement). Markdown only — **if any doc claim can't be made true without touching code, stop and surface it** rather than editing code in this slice.
- **Gates:** `pnpm lint:rules:symlinks` / markdown link integrity for moved/added doc links; `pnpm lint:deps` unaffected (no code). No build/test (docs only) beyond link checks.

## Close-out (post-D1, not a dispatch)

`drive-close-project`: verify project DoD across all four slices → mandatory retro → migrate any long-lived methodology into `docs/` → delete `projects/target-contributed-psl-blocks/` → scrub repo-wide references → open the close-out PR.
