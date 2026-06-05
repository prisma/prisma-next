# Slice `substrate` — Dispatch Plan

**Slice spec:** Project spec at [`../../spec.md`](../../spec.md) — substrate scope is in "What this is" / "Cross-cutting design constraints" / "Project-DoD".

**Linear:** [TML-2804](https://linear.app/prisma-company/issue/TML-2804)

## At a glance

The slice was first built across four dispatches (D1–D4, all reviewed SATISFIED), then opened as PR #718. Review surfaced a vocabulary problem ("pack"/"substrate"/"pack block") and an architectural one (parser + printer expressed as two descriptors when they're one inseparable unit), plus code-quality findings. Two restructure dispatches (R5, R6) bring the slice to the shape the amended spec describes. The branch is rebased onto current main (incorporating ADR 224 / #715); the final PR is force-pushed with a clean, coherent history.

## As-built dispatches (D1–D4) — committed, then superseded by the restructure

These landed and were each reviewed SATISFIED. They are the substrate's first cut; R5/R6 reshape them. Kept here as the record of how the slice was built.

- **D1 — substrate types + (old) triple-bundle validation.** Two namespaces (`pslBlocks` + `pslPrinters`) + `entityTypes`, tied by discriminator, validated as a triple-bundle. *(R5 collapses the two namespaces into one descriptor.)*
- **D2 — AST `packBlocks` slot + parser dispatch + parser SPI.** *(R6 renames the slot/types; R5 keeps the dispatch but consumes the merged descriptor.)*
- **D3 — printer dispatch (two phases) + printer SPI + CLI `contract infer` threading.** *(R5 moves the printer onto the merged descriptor; R6 renames.)*
- **D4 — integration-test fixture + end-to-end round-trip.** *(R5/R6 update the fixture to the merged, renamed shape.)*

## Restructure dispatches

### Dispatch 5 (R5): collapse the descriptor + fix validation

- **Outcome:** Parser and printer live on a single `AuthoringPslBlockDescriptor` (fields `parser` + `printer`). `AuthoringPslPrinterDescriptor`, the `pslPrinters` namespace, and `isAuthoringPslPrinterDescriptor` are gone. The parser↔printer cross-check is gone (structurally impossible to violate with one descriptor). The block-descriptor↔`entityTypes`-factory check remains (a block requires a matching factory; a factory may still stand alone). Malformed descriptor objects (carry `kind`/`discriminator` but don't satisfy the descriptor shape) are rejected at load time rather than silently skipped (CodeRabbit finding). The optional `stack?.` in `ControlClient.getPslPrintersNamespace` (now `…PslBlocks…`) is audited — either `stack` is asserted-present post-`init()` and the `?.`/`?? {}` drop, or its optionality is justified in a comment.
- **Builds on:** D1–D4 as committed (rebased onto current main).
- **Hands to:** The settled descriptor shape — one namespace, one descriptor type carrying parser + printer, validated against a matching factory. R6 renames against this settled structure.
- **Focus:** `framework-authoring.ts` (merge descriptors, drop the printer descriptor + guard + cross-check, fix malformed-descriptor validation), `control-stack.ts` (merge wiring), parser + printer dispatch sites (consume the merged descriptor's `parser` / `printer`), the CLI `getPsl*Namespace` method (audit `stack?.`), the fixture + tests (merged shape). Vocabulary stays "pack" for now — R6 sweeps it. This dispatch is design-judgment work, concentrated in the descriptor + validation.
- **Completed when:**
  - `pnpm typecheck` + `pnpm lint:deps` + `pnpm lint:casts` (no regression) pass.
  - `pnpm test:packages -- @prisma-next/framework-components @prisma-next/psl-parser @prisma-next/psl-printer @prisma-next/cli` passes.
  - A test pins malformed-descriptor rejection.
  - No parser↔printer cross-check remains (`rg` confirms); the block↔factory check remains and is tested.

### Dispatch 6 (R6): vocabulary sweep

- **Outcome:** "pack" is gone from this slice's surface — replaced by "extension" per the glossary. "substrate" is gone (the `psl-substrate.ts` file is renamed; no "substrate" prose remains in the slice's code/comments). `PslPackBlock` → `PslExtensionBlock`; `packBlocks` slot → `extensionBlocks`; `PslPackBlock{Parser,Printer}Context` → `PslExtensionBlock{Parser,Printer}Context`. The `Ref: TML-2804` breadcrumb in the (renamed) file header is dropped. Behaviour-preserving.
- **Builds on:** R5's settled descriptor shape.
- **Hands to:** The slice in its final shape, matching the amended spec's vocabulary and structure.
- **Focus:** A mechanical rename/codemod across the slice's files + the PR description. No behaviour change. Reviewer confirms the diff is purely vocabulary + the `Ref:` drop.
- **Completed when:**
  - `pnpm typecheck` + `pnpm lint:deps` pass; full `pnpm test:packages` for the four packages passes unchanged.
  - `rg -i '\bpack\b|substrate|PslPackBlock|packBlocks'` over the slice's files returns only legitimate hits (e.g. unrelated pre-existing "pack" in untouched code), none in this slice's surface.
  - No `Ref: TML-2804` (or other transient-ID breadcrumbs) in the renamed file.

## Slice-DoD coverage (final shape)

| Project-DoD item | Delivered by | Reshaped by |
|---|---|---|
| `pslBlocks` namespace; descriptor carries parser + printer; end-to-end type narrowing | D1–D3 | R5 (collapse), R6 (rename) |
| Load-time validation (within-namespace dup; block↔factory; malformed-descriptor reject) | D1 | R5 |
| Parser dispatch consults `pslBlocks`; clean unknown-keyword diagnostic | D2 | R5/R6 |
| Generic `extensionBlocks` slot on `PslNamespace` (2a — no `entries` migration) | D2 | R6 (rename from `packBlocks`) |
| Printer's two phases dispatch via the descriptor's `printer` | D3 | R5/R6 |
| Integration-test fixture round-trips end-to-end | D4 | R5/R6 |
| Existing parser-printer round-trip preserved | D3 + D4 | — |
| `contract infer` works for extension-contributed kinds | D3 + D4 | R5/R6 |

Project-DoD items 9 (ADR), 10 (`AGENTS.md` fix), 11 (project-dir deletion) belong to Slice 2 (TML-2806), out of scope here.

## Sequencing rationale

R5 (judgment) before R6 (mechanical) follows the calibration rule: make the design decision in one place, then fan the resolved shape out mechanically — never bury a judgment site inside a rename's diff. R5 settles the descriptor structure; R6 sweeps vocabulary across the settled structure so its diff is reviewable as a pure rename.

The branch is force-pushed with squashed/coherent history at slice close — the D1–D4 + R5 + R6 working commits collapse into commits that read against the final shape, not the path that produced it.
