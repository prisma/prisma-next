# Slice `substrate` — Dispatch Plan

**Slice spec:** Project spec at [`../../spec.md`](../../spec.md) — substrate scope is in "What this is" / "Cross-cutting design constraints" / "Project-DoD".

**Linear:** [TML-2804](https://linear.app/prisma-company/issue/TML-2804)

## At a glance

The slice was first built across four dispatches (D1–D4, all reviewed SATISFIED), then opened as PR #718. Review surfaced a vocabulary problem ("pack"/"substrate"/"pack block") and an architectural one (parser + printer expressed as two descriptors when they're one inseparable unit), plus code-quality findings. Two restructure dispatches (R5, R6) bring the slice to the shape the amended spec describes. The branch is rebased onto current main (incorporating ADR 224 / #715); the final PR is force-pushed with a clean, coherent history.

A second review round on PR #718 (the local review under [`reviews/pr-718/`](reviews/pr-718/)) surfaced a further set of in-scope findings. Two more dispatches address them — **R7** hardens the contributed-block contract and closes the test gaps the review named (behavioural/judgment), **R8** finishes the incomplete "pack"→"extension" sweep and removes the transient-ID breadcrumbs (mechanical). R7-before-R8 follows the same judgment-before-mechanical split as R5→R6. The `entries` migration the architect pass raised is deliberately *not* here — it is the project's closing slice ([TML-2849](https://linear.app/prisma-company/issue/TML-2849)).

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

## Review-remediation dispatches (PR #718 review)

These address the in-scope findings from the local review under [`reviews/pr-718/`](reviews/pr-718/) — principal-engineer findings F01–F05 + F07 and architect findings #1, #2, #4. F06 (cross-kind print order) is flagged for the RLS consumer, not changed here; architect #3 (term-mapping) lands in the TML-2806 ADR; architect #5 (`entries`) is the closing slice TML-2849. Both dispatches run on the implementer tier (Sonnet-4.6-mid); the reviewer pass runs on Opus-4.8-mid.

### Dispatch 7 (R7): harden the contributed-block contract + close the test gaps

- **Outcome:** The contributed-PSL-block contract is enforced at the framework parser boundary, and the two test gaps the review named are closed. Concretely: (a) a contributed parser that **throws** is caught at the dispatch site and converted to a `PSL_*` diagnostic against the block span — the document keeps parsing, one bad block degrades to a diagnostic instead of crashing the whole parse (F04); (b) a contributed parser that returns **`undefined`** produces a diagnostic, not a silent drop — the dead `if (node)` tolerance becomes an explicit diagnostic branch (F04); (c) the dispatch **asserts `node.kind === descriptor.discriminator`** immediately after the parser returns, failing at parse time with the descriptor named, so a discriminator typo no longer surfaces far away at `contract infer` print time (F05); (d) the `kind === discriminator` invariant is documented on both type sites — `AuthoringPslBlockDescriptor.discriminator` and `PslExtensionBlock.kind` (architect #1); (e) a **command-level test** drives a real `fake_policy` block through the actual `contract infer` command path and asserts the written PSL contains the block, turning AC8 from WEAK to PASS (F03); (f) the type test declares the fixture `parser`/`printer` as **methods** (not arrow properties) so it pins the method-bivariance the descriptor JSDoc relies on (architect #4, AC1).
- **Builds on:** PR #718 as merged-to-branch — the settled single-descriptor shape from R5/R6 — and the review artifacts under [`reviews/pr-718/`](reviews/pr-718/).
- **Hands to:** A substrate whose contributed-block contract is checked at the boundary (no crash, no silent drop, no far-from-cause print-time failure) and whose AC1/AC8 evidence exists at the layer each AC names — a settled behavioural surface R8 sweeps vocabulary over.
- **Focus:** `psl-parser/src/parser.ts` (dispatch site ~lines 220–247: wrap `invokeExtensionBlockParser`, add the `kind === discriminator` check, convert `undefined`/throw to diagnostics); the `PslDiagnosticCode` union in `framework-components/src/shared/psl-extension-block.ts` (reuse a fitting `PSL_*` code or add one for block-parse failure); invariant JSDoc on the descriptor (`framework-authoring.ts`) and on `PslExtensionBlock.kind` (`psl-extension-block.ts`); `cli/test/commands/contract-infer.command.test.ts` (new command-level test); `framework-components/test/framework-authoring-psl.types.test-d.ts` (method-form fixture). **Decisions pre-settled in this brief:** F04 takes option (a) — throw→diagnostic, undefined→diagnostic; do **not** adopt "contributor owns correctness, let it throw." Do **not** rename the node `kind` field — it is the AST-wide discriminant. Vocabulary stays "pack" where it currently is; R8 sweeps it.
- **Completed when:**
  - `pnpm typecheck` + `pnpm lint:deps` + `pnpm lint:casts` (no regression) pass.
  - `pnpm test:packages -- @prisma-next/psl-parser @prisma-next/psl-printer @prisma-next/framework-components @prisma-next/cli` passes.
  - Tests pin: contributed-parser-throws → diagnostic with the parse continuing; contributed-parser-returns-`undefined` → diagnostic; `kind` ≠ `discriminator` → fails at parse time naming the descriptor.
  - The `contract infer` command test asserts a `fake_policy` block survives into the written PSL.
  - The type test stops compiling if the fixture `parser`/`printer` are declared with an incompatible node type (method-bivariance pinned).

### Dispatch 8 (R8): finish the vocabulary sweep + remove transient-ID breadcrumbs

- **Outcome:** "pack" is gone from this slice's own surface and the transient-ID breadcrumbs are removed. Concretely: the three `Ref: TML-2804.` header lines are deleted (F01); the fixture file `fake-target-pack.ts` and the `*pack-blocks*` / `fake-target-pack*` test files are renamed to extension vocabulary; the `fakeTargetPackContributions` export is renamed; the two CLI production comments ("Pack-contributed…" in `inspect-live-schema.ts` and `control-api/types.ts`) and the test description ("with the pack registries in scope") become "extension"; the "pack-bag-driven" / "pack literal" wording in the `AuthoringEntityTypeFactoryOutput` docstring (`framework-authoring.ts` ~lines 125–136) becomes "extension" (F02 + F07 + architect #2). Behaviour-preserving.
- **Builds on:** R7's settled behavioural surface — the sweep runs over the final set of files, including R7's new command-level test and method-form type test.
- **Hands to:** The slice in its final shape — "extension" vocabulary throughout this slice's surface, no transient-ID breadcrumbs — ready for re-review and merge.
- **Focus:** A mechanical rename/codemod plus line deletions across the slice's files and the PR description. No behaviour change. The replacement word is "extension" (the architect pass's decided call). Reviewer confirms the diff is purely vocabulary + the `Ref:` deletions.
- **Completed when:**
  - `pnpm typecheck` + `pnpm lint:deps` pass; full `pnpm test:packages` for the four packages passes unchanged.
  - `rg -i '\bpack\b|fakeTargetPack|pack-blocks|Pack-contributed|pack-bag'` over the slice's files returns only legitimate pre-existing hits in untouched code, none in this slice's surface.
  - `rg 'Ref: TML-2804'` over the slice's files returns empty.

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

R7 before R8 repeats that split for the second review round: R7 settles the behavioural changes (failure contract, invariant check, test gaps), R8 sweeps the remaining vocabulary over the now-final set of files (including the ones R7 adds). Bundling them would put a design-judgment site — the contributed-parser failure contract — inside a rename diff, the exact mis-sizing `drive/calibration/sizing.md` calls out ("mechanical fan-out + design judgment in one dispatch"). The review's `entries` finding (architect #5) is *not* a dispatch here: it is a framework-wide PSL-AST migration, scoped as the project's closing slice (TML-2849), per the decision recorded in the project spec.

The branch is force-pushed with squashed/coherent history at slice close — the D1–D4 + R5 + R6 working commits collapse into commits that read against the final shape, not the path that produced it.
