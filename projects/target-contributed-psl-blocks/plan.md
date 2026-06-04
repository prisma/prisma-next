# target-contributed-psl-blocks — Plan

**Spec:** `projects/target-contributed-psl-blocks/spec.md`
**Linear Project:** [Target-contributed top-level PSL blocks](https://linear.app/prisma-company/project/target-contributed-top-level-psl-blocks-087bdb454e6a)

## At a glance

Two slices, stacked. Slice 1 ships the substrate and the integration-test fixture that exercises it end-to-end. Slice 2 ships the durable ADR + subsystem docs and closes the project out. The two are sequenced because the ADR is likely to incorporate learnings from substrate implementation (parser SPI shape decisions, diagnostic copy refinements, edge cases the fixture surfaces) — drafting it before Slice 1 lands risks rework.

## Composition

### Stack (deliver in order)

1. **Slice `substrate`** — Linear: [TML-2804](https://linear.app/prisma-company/issue/TML-2804)
   - **Outcome:** `pslBlocks` and `pslPrinters` namespaces exist on `AuthoringContributions` with end-to-end type narrowing. The framework parser's top-level dispatch and the framework printer's two phases consult the registries. Pack-load-time validation rejects within-namespace duplicates and cross-namespace discriminator mismatches (a `pslBlocks` contribution without a matching `pslPrinters` and `entityTypes` fails at pack-load time, naming the offending pack). An integration-test fixture target pack ships an RLS-shaped triple-contribution (parser, printer, factory) and round-trips parse → lower → IR class instance → serialize → hydrate → IR class instance → print → re-parse with the result equal to the original. The existing parser-printer round-trip test continues to pass for framework-parsed blocks.
   - **Builds on:** None internal. PR2 (TML-2520) has merged.
   - **Hands to:** A working `pslBlocks` + `pslPrinters` substrate that downstream projects consume directly — RLS is the first real consumer, in `projects/postgres-rls/`. The integration-test fixture serves as the regression test for the mechanism going forward. Slice 2 inherits the as-shipped API names, diagnostic copy, and any SPI-shape choices that emerged in implementation.
   - **Focus:** Substrate code in `packages/1-framework/1-core/framework-components/` (the new namespaces + descriptors + type guards + validation extensions), `packages/1-framework/2-authoring/psl-parser/` (top-level dispatch consulting the registry; parser SPI extraction — minimal-by-default, only what the fixture parser consumes), `packages/1-framework/2-authoring/psl-printer/` (both `astDocumentToPrintDocument` and `serializePrintDocument` phases consulting the registry; `PrintNamespaceSection` gains a generic packBlocks slot), and the integration-test fixture (test-only code; no production-pack contribution ships from this slice). The framework's `PslNamespace` gains a generic `packBlocks: readonly PslPackBlock[]` slot with the base shape `{ kind: string; name: string; span: PslSpan }`.

2. **Slice `adr-and-close-out`** — Linear: [TML-2806](https://linear.app/prisma-company/issue/TML-2806)
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

Slice 2 is markdown-only and the spec already commits to the API names. In principle it could parallelise with Slice 1's implementation. In practice the ADR is likely to incorporate learnings from substrate work — parser-SPI shape choices that emerged in recon, diagnostic copy refinements the integration-test fixture surfaced, edge cases that shaped the validation diagnostics. Drafting the ADR before Slice 1 lands risks rework, so the slices are sequenced. The close-out step (project-dir deletion) gates on Slice 1's merge regardless.

The substrate stays as one slice rather than split into "parser side" / "printer side" because pack-load-time validation refuses to load a `pslBlocks` contribution without a matching `pslPrinters` (per the spec's validation constraint). A parser-only slice would ship a registry no contribution can use without immediately failing validation — preparation, not value. The substrate's coherence comes from shipping both halves of the round-trip together, exercised by the integration-test fixture as the cohesion glue.
