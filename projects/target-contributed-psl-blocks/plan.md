# target-contributed-psl-blocks — Plan

**Spec:** `projects/target-contributed-psl-blocks/spec.md`
**Linear Project:** [Target-contributed top-level PSL blocks](https://linear.app/prisma-company/project/target-contributed-top-level-psl-blocks-087bdb454e6a)

## At a glance

Three slices, stacked. Slice 1 ships the substrate and the integration-test fixture that exercises it end-to-end, with extension-contributed blocks landing in an interim generic `extensionBlocks` slot. Slice 2 completes the PSL-AST coordinate transition — `PslNamespace` migrates onto ADR 224's `entries[kind][name]` shape, folding the interim slot and the built-in per-kind slots into one coordinate container. Slice 3 ships the durable ADR + subsystem docs and closes the project out. The slices are sequenced: the migration builds on the substrate's contributed-block shape, and the ADR records the converged coordinate shape, so drafting it before the migration lands risks rework.

## Composition

### Stack (deliver in order)

1. **Slice `substrate`** — Linear: [TML-2804](https://linear.app/prisma-company/issue/TML-2804)
   - **Outcome:** `pslBlocks` and `pslPrinters` namespaces exist on `AuthoringContributions` with end-to-end type narrowing. The framework parser's top-level dispatch and the framework printer's two phases consult the registries. Pack-load-time validation rejects within-namespace duplicates and cross-namespace discriminator mismatches (a `pslBlocks` contribution without a matching `pslPrinters` and `entityTypes` fails at pack-load time, naming the offending pack). An integration-test fixture target pack ships an RLS-shaped triple-contribution (parser, printer, factory) and round-trips parse → lower → IR class instance → serialize → hydrate → IR class instance → print → re-parse with the result equal to the original. The existing parser-printer round-trip test continues to pass for framework-parsed blocks.
   - **Builds on:** None internal. PR2 (TML-2520) has merged.
   - **Hands to:** A working `pslBlocks` + `pslPrinters` substrate that downstream projects consume directly — RLS is the first real consumer, in `projects/postgres-rls/`. The integration-test fixture serves as the regression test for the mechanism going forward. Slice 2 inherits the as-shipped API names, diagnostic copy, and any SPI-shape choices that emerged in implementation.
   - **Focus:** Substrate code in `packages/1-framework/1-core/framework-components/` (the new namespaces + descriptors + type guards + validation extensions), `packages/1-framework/2-authoring/psl-parser/` (top-level dispatch consulting the registry; parser SPI extraction — minimal-by-default, only what the fixture parser consumes), `packages/1-framework/2-authoring/psl-printer/` (both `astDocumentToPrintDocument` and `serializePrintDocument` phases consulting the registry; `PrintNamespaceSection` gains a generic packBlocks slot), and the integration-test fixture (test-only code; no production-pack contribution ships from this slice). The framework's `PslNamespace` gains a generic `packBlocks: readonly PslPackBlock[]` slot with the base shape `{ kind: string; name: string; span: PslSpan }`.

2. **Slice `entries-migration`** — Linear: [TML-2849](https://linear.app/prisma-company/issue/TML-2849)
   - **Outcome:** `PslNamespace` migrates from per-kind slots + the interim `extensionBlocks` array onto ADR 224's `entries[kind][name]` coordinate shape. Built-in kinds (`model` / `enum` / `compositeType`) and extension-contributed kinds live under one `entries` container, addressed by the same coordinate expression — no per-kind dispatch in PSL consumers. The parser writes `entries`; both printer phases read it; `sqlSchemaIrToPslAst` and every PSL-AST consumer + test are updated. The parser→printer round-trip is preserved for built-in and contributed kinds.
   - **Builds on:** Slice 1's merged substrate — the contributed-block shape it converges. Mirrors ADR 224's IR-layer `entries` shape.
   - **Hands to:** A PSL AST whose entity-coordinate system matches the contract IR's, so the ADR (Slice 3) can describe one coordinate shape across both IR trees, and downstream PSL consumers can walk `entries` structurally rather than special-casing kinds.
   - **Focus:** Framework `PslNamespace` (`psl-ast.ts`), the parser, both printer phases (`ast-to-print-document.ts`, `serialize-print-document.ts`), `sqlSchemaIrToPslAst`, and PSL-AST consumers + tests. Framework-internal storage-shape change — extension contributions interact via the descriptor SPI and should not need changes.

3. **Slice `adr-and-close-out`** — Linear: [TML-2806](https://linear.app/prisma-company/issue/TML-2806)
   - **Outcome:** Three-layer extensibility ADR lands under `docs/architecture docs/adrs/` (names IR, semantic lowering, parsing+printing as the three corners; pins the discriminator string convention `<target-or-family>-<kind>`; cites ADR 221 as the IR layer's authority). PSL parser + printer subsystem docs reference the ADR and describe the `pslBlocks` / `pslPrinters` contribution path with a minimal example. `AGENTS.md` references `AuthoringContributions.entityTypes` correctly (the current `AuthoringContributions.entities` doc-bug is fixed). `projects/target-contributed-psl-blocks/` is deleted; in-tree references to the project dir are scrubbed per `.cursor/rules/doc-maintenance.mdc`.
   - **Builds on:** Slice 1's merged substrate — the ADR codifies what Slice 1 actually ships, including any API-name choices or diagnostic copy refinements that emerged in implementation.
   - **Hands to:** Durable architectural record of the three-layer extensibility story for downstream projects (RLS, roles, custom Postgres types) to cite. Project directory removed; tree clean.
   - **Focus:** Markdown-only changes. ADR drafting, subsystem doc updates, the one-line AGENTS.md correction, and project-dir deletion. No code changes.

## Closed (not delivered)

- **Slice `enum-migration`** — Linear: [TML-2805](https://linear.app/prisma-company/issue/TML-2805) — Closed. The original plan's `enum`-migration scope is dropped; `enum` stays framework-parsed because it's an application-level (domain-plane) concept. The cross-target enum work is tracked separately in [TML-2815](https://linear.app/prisma-company/issue/TML-2815).

## Dependencies (external)

- **TML-2520 (PR2 — Namespace exemplar + cross-namespace FKs)** — Merged. The parser changes from PR2 (the `namespace { … }` block, `PslDocumentAst.namespaces` reshape) are in place; this project builds on top of them.
- **TML-2815 (enum-as-domain-plane)** — Sibling, not blocking. Explicit non-goal in this project's spec; tracked independently and runs in parallel.

## Sequencing rationale

Slice 2 (entries migration) is sequenced after Slice 1 because it converges the contributed-block shape the substrate ships — it cannot start until that shape exists. Slice 3 (ADR + close-out) is markdown-only, but it runs last: the ADR records the *converged* coordinate shape, so it should be drafted after the migration lands rather than after the substrate alone. Drafting it earlier risks rework as the migration reshapes `PslNamespace`. Close-out (project-dir deletion) runs after every other slice has merged.

The substrate stays as one slice rather than split into "parser side" / "printer side" because pack-load-time validation refuses to load a `pslBlocks` contribution without a matching `pslPrinters` (per the spec's validation constraint). A parser-only slice would ship a registry no contribution can use without immediately failing validation — preparation, not value. The substrate's coherence comes from shipping both halves of the round-trip together, exercised by the integration-test fixture as the cohesion glue.
