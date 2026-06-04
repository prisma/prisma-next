# Slice `substrate` — Dispatch Plan

**Slice spec:** Project spec at [`../../spec.md`](../../spec.md) — the substrate scope is captured in the project spec's "What this is" / "Cross-cutting design constraints" / "Project-DoD" sections, plus the project plan's Slice 1 entry.

**Linear:** [TML-2804](https://linear.app/prisma-company/issue/TML-2804)

## At a glance

Four dispatches, sequential. The substrate is built ground-up — types and validation first, then the parser side, then the printer side, finally the integration-test fixture that exercises the whole round-trip. Each prior dispatch's hand-off is a stable state the next dispatch builds on; the final dispatch closes the slice-DoD by demonstrating end-to-end round-trip with a real fixture target pack.

## Dispatch plan

### Dispatch 1: substrate types + triple-bundle validation

- **Outcome:** `AuthoringContributions.pslBlocks` and `AuthoringContributions.pslPrinters` namespaces exist, with descriptors and type guards structurally parallel to `entityTypes`. The descriptor-build-time validation extends to: (a) within-namespace duplicates throw via `mergeAuthoringNamespaces`; (b) cross-namespace collisions surface via `assertNoCrossRegistryCollisions`; (c) a new triple-bundle check rejects pack-load if any of `pslBlocks` / `pslPrinters` / `entityTypes` is missing its discriminator-matched siblings, naming the contributing pack and the offending discriminator. Type narrowing is end-to-end strong: a pack's contributed parser's return type narrows to the AST node shape its printer + factory consume.
- **Builds on:** None. The chosen design is the spec's `pslBlocks` / `pslPrinters` namespace shape mirroring `entityTypes`.
- **Hands to:** Working framework-components substrate that exposes the new namespaces with type narrowing and rejects malformed pack contributions at descriptor-build time. No parser or printer changes yet — pack-contributed parsers and printers cannot be invoked, but they can be declared and validated.
- **Focus:** Pure framework-components changes. New code in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` (descriptors, type guards, namespaces) and `packages/1-framework/1-core/framework-components/src/control/control-stack.ts` (merge extension, validation extension, new triple-bundle check). Out of scope here: AST changes, parser changes, printer changes, fixture pack.
- **Completed when:**
  - `pnpm typecheck` passes.
  - `pnpm test:packages -- @prisma-next/framework-components` passes, including new tests asserting (a) within-namespace duplicate rejection; (b) cross-namespace collision rejection; (c) triple-bundle mismatch rejection (each direction: pslBlocks-without-pslPrinters, pslBlocks-without-entityTypes, etc.).
  - End-to-end type narrowing demonstrated by a type-level test (vitest `expectTypeOf` or equivalent) showing parser-return → printer-input → factory-input narrows correctly.

### Dispatch 2: AST `packBlocks` slot + parser dispatch + parser SPI extraction

- **Outcome:** Framework AST types include a generic `packBlocks: readonly PslPackBlock[]` slot on `PslNamespace`, with the base shape `{ kind: string; name: string; span: PslSpan }`. The framework parser's top-level dispatch consults `AuthoringContributions.pslBlocks` for unknown identifiers before falling back to the existing "unknown top-level keyword" diagnostic; pack-contributed parsers populate the new slot with their typed AST nodes. A minimal parser SPI is extracted to `packages/1-framework/2-authoring/psl-parser/src/exports/` (or equivalent) — only the helpers a pack-contributed parser actually needs (token cursor + diagnostic sink + block-bounds finder + brace-delimited body walker; nothing speculative). The diagnostic for an unrecognised top-level keyword names the keyword and points at the offending span.
- **Builds on:** Dispatch 1's substrate — `pslBlocks` registry exists and validation rejects malformed contributions. Tests for this dispatch construct fake `AuthoringContributions` objects that pass validation (i.e. include matching `pslPrinters` and `entityTypes` stubs) but only exercise the parser side.
- **Hands to:** Pack-contributed parsers participate in framework parsing — given a registered `pslBlocks.<keyword>` contribution, source text containing that keyword parses into a typed AST node tagged with the contribution's discriminator and stored in the new `packBlocks` slot. The parser SPI is a stable framework export.
- **Focus:** AST type changes (`packages/1-framework/1-core/framework-components/src/control/psl-ast.ts`), parser dispatch (`packages/1-framework/2-authoring/psl-parser/src/parser.ts`), and parser SPI extraction. Out of scope here: printer changes, fixture pack, end-to-end round-trip.
- **Completed when:**
  - `pnpm typecheck` passes.
  - `pnpm test:packages -- @prisma-next/psl-parser` passes, including new tests asserting (a) a registered `pslBlocks.<keyword>` parser is invoked on its keyword and produces the expected AST node in the namespace's `packBlocks` slot; (b) an unknown top-level keyword that no in-scope pack contributes surfaces the existing `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` diagnostic with the keyword named and span pointed at it; (c) the existing parser tests for built-in keywords (`model`, `enum`, `type`, `types`, `namespace`) continue to pass.
  - The parser SPI is exported from `psl-parser`'s public surface and consumable by tests.

### Dispatch 3: printer dispatch (AST → PrintDocument and PrintDocument → string)

- **Outcome:** The framework printer's two phases consult `AuthoringContributions.pslPrinters` for pack-contributed blocks. `astDocumentToPrintDocument` populates `PrintNamespaceSection`'s new generic packBlocks slot via the registered `pslPrinters.<keyword>` contribution; `serializePrintDocument` renders that slot's entries by consulting the same registry. The existing parser-printer round-trip test continues to pass for framework-parsed blocks (`model`, `enum`, `type`, `types`).
- **Builds on:** Dispatch 1's substrate (registries exist with validation) + Dispatch 2's AST changes (`packBlocks` slot is populated by the parser). Tests for this dispatch construct AST documents containing `packBlocks` entries (either by parsing through Dispatch 2's machinery or by constructing AST objects directly) and verify both printer phases handle them via the registry.
- **Hands to:** Pack-contributed blocks round-trip through parse → print, completing the printer half of the round-trip property. `contract infer` (which calls `printPsl` to render IR-to-PSL) works for pack-contributed block kinds — verified at the printer level here, end-to-end at Dispatch 4.
- **Focus:** Printer changes: `packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts`, `serialize-print-document.ts`, `print-document.ts` (the `PrintNamespaceSection` shape extension). Out of scope here: fixture pack, end-to-end round-trip test, IR factories.
- **Completed when:**
  - `pnpm typecheck` passes.
  - `pnpm test:packages -- @prisma-next/psl-printer` passes, including new tests asserting (a) a `PslDocumentAst` containing pack-contributed `packBlocks` is rendered correctly via the registered `pslPrinters.<keyword>` contribution; (b) the existing round-trip test (`parser → printer → parser` produces equivalent AST) continues to pass for framework-parsed blocks.

### Dispatch 4: integration-test fixture target pack + end-to-end round-trip

- **Outcome:** A test-only fixture target pack ships all three contributions (`pslBlocks.<keyword>`, `pslPrinters.<keyword>`, `entityTypes.<keyword>`) for one RLS-shaped block keyword (block name + named-arg body + string-valued predicates) with the same discriminator across all three. An integration test runs the round-trip parse → lower → IR class instance → serialize → hydrate → IR class instance → print → re-parse and asserts the result is equal to the original. This is the regression test for the substrate going forward; future projects (RLS, roles) consume the substrate by following the fixture's pattern.
- **Builds on:** Dispatch 1 + 2 + 3 — the entire substrate. The fixture pack's parser uses the SPI from Dispatch 2; its printer participates in the dispatch from Dispatch 3; its factory uses the existing `entityTypes` registry; all three contributions pass triple-bundle validation from Dispatch 1.
- **Hands to:** Slice-DoD met. Substrate works end-to-end; the integration test pins the round-trip property going forward; no production-pack contribution ships from this slice (the fixture lives in test-only code).
- **Focus:** New fixture pack code (test-only, lives somewhere like `packages/1-framework/2-authoring/psl-parser/test/fixtures/fake-target-pack/` or a similar test-adjacent location), the integration test, and possibly a small AGENTS.md / CLAUDE.md note about the fixture as the canonical example for downstream consumers. Out of scope here: real production-pack contributions (RLS lives in `projects/postgres-rls/`), the AGENTS.md `entities` → `entityTypes` doc-bug fix (that's Slice 2's scope).
- **Completed when:**
  - `pnpm typecheck` passes.
  - The integration test asserts round-trip equality for a multi-block PSL document containing both built-in blocks (`model`) and the fixture's pack-contributed block.
  - `pnpm test:packages` passes globally — no regressions in any existing test.
  - `pnpm lint:deps` passes — no import-graph violations introduced.
  - Spot-check: `contract infer` (or its programmatic equivalent in tests) renders a contract IR containing the fixture pack's IR class instances back to PSL source that re-parses to the equivalent IR.

## Hand-off chain

```
D1 (substrate types + validation) → D2 (AST slot + parser) → D3 (printer) → D4 (fixture + round-trip)
```

Each dispatch's `Builds on` references the immediate prior dispatch's `Hands to`; no non-linear dependencies. The final dispatch's `Hands to` is the slice-DoD.

## Slice-DoD coverage

The project spec's Project-DoD items mapped to the dispatch sequence:

| Project-DoD item | Delivered by |
|---|---|
| `pslBlocks` and `pslPrinters` namespaces with type narrowing | D1 |
| Pack-load-time validation (within-namespace + cross-namespace + triple-bundle) | D1 |
| Framework parser dispatch consults `pslBlocks` | D2 |
| Framework printer's two phases consult `pslPrinters` | D3 |
| Integration-test fixture round-trips end-to-end | D4 |
| Existing parser-printer round-trip test continues to pass | D3 (preserved) + D4 (verified globally) |
| Clean diagnostic for unknown top-level keyword | D2 |
| `contract infer` works for pack-contributed kinds | D3 + D4 |

The remaining Project-DoD items (three-layer ADR, `AGENTS.md` correction, project-dir deletion) belong to Slice 2 and are out of scope here.
