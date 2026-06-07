# target-contributed-psl-blocks — Plan

**Spec:** `projects/target-contributed-psl-blocks/spec.md`
**Linear Project:** [Target-contributed top-level PSL blocks](https://linear.app/prisma-company/project/target-contributed-top-level-psl-blocks-087bdb454e6a)

## At a glance

Four slices, stacked. The SPI is **declarative**: an extension describes a top-level PSL block as data (keyword, name, typed parameters); the framework owns one generic parser / validator / printer. Slice 1 ships the read side (descriptor + generic parse/validate/lower). Slice 2 ships the write side (generic printer + `contract infer`). Slice 3 converges the PSL AST onto the IR's `entries` coordinate shape. Slice 4 revises ADR 126, lands the three-layer ADR, and closes the project out.

This supersedes the **function-based** SPI built on PR #718 (now draft): the prior cut had each extension ship imperative `parser`/`printer` functions. The mechanism it built is cherry-picked; the functions are replaced by a declarative descriptor + generic interpreter. See the spec's "Why declarative" and "Alternatives considered."

## Composition

### Stack (deliver in order)

1. **Slice `declarative-substrate`** — Linear: [TML-2804](https://linear.app/prisma-company/issue/TML-2804)
   - **Outcome:** `AuthoringContributions.pslBlocks` carries declarative descriptors (keyword, discriminator, `name`, a `parameters` map of kinds `ref`/`value`/`option`/`list`) — no `parser`/`printer` functions. One generic framework parser reads any declared block into a uniform AST node (name + parameter map) on the `extensionBlocks` slot; one generic validator reports unknown/missing parameters, `option`-not-in-set, codec-rejected `value`, and out-of-scope `ref`; the node lowers to IR via the matching `entityTypes` factory. `value` parses through its codec (PSL→literal hook added here); `ref` scope (`same-namespace`/`same-space`/`cross-space`) is enforced against the `(spaceId, namespaceId, …)` coordinate model (PR #745 / TML-2500). A test-only fixture (RLS-shaped `policy_*`) round-trips parse → validate → lower → IR.
   - **Builds on:** PR #718's merged-to-branch mechanism (cherry-picked: `extensionBlocks` slot, keyword dispatch + diagnostic, load-time validation incl. duplicate-discriminator + malformed-descriptor checks, `entityTypes` lowering link, discriminator convention, round-trip harness). Drops the contributed parser/printer functions + their failure-isolation machinery.
   - **Hands to:** A working declarative read path — descriptor → uniform AST node → validated → IR. Slice 2 adds the print side; Slice 3 reshapes where the node lives.
   - **Focus:** `framework-components` (descriptor types + `ref`/`value`/`option`/`list` vocabulary + generic validator + load-time validation), `psl-parser` (generic block parser + dispatch), the codec PSL→literal parse hook, the `entityTypes` factory, the integration-test fixture. Vocabulary is `ref`/`value`/`option`/`list` only; defer `number` and field-declaration block bodies.

2. **Slice `printer-and-infer`** — Linear: [TML-2854](https://linear.app/prisma-company/issue/TML-2854)
   - **Outcome:** One generic framework printer renders any declared block from its descriptor + uniform AST node; `value` parameters print through the codec's PSL print-back hook; the CLI's `contract infer` threads the `pslBlocks` namespace so declared blocks survive inference to disk. The fixture round-trip extends to the full `parse → validate → lower → IR → serialize → hydrate → IR → print → re-parse` chain.
   - **Builds on:** Slice 1's declarative descriptor + uniform AST node. Cherry-picks #718's two-phase printer plumbing + `contract infer` threading (the render dispatch now reads the descriptor instead of calling a contributed printer; the throw-on-missing-descriptor behaviour stays).
   - **Hands to:** A complete round-tripping declarative SPI — RLS (a downstream project) can build on it. Slice 1 + Slice 2 together are the substrate.
   - **Focus:** the codec literal→PSL print hook, `psl-printer` (both phases), `cli` (`contract infer`), the fixture round-trip + a command-level `contract infer` test.

3. **Slice `entries-migration`** — Linear: [TML-2849](https://linear.app/prisma-company/issue/TML-2849)
   - **Outcome:** `PslNamespace` converges on ADR 224's `entries[kind][name]` coordinate shape; built-in and extension-contributed kinds are addressed uniformly; PSL consumers stop special-casing kinds.
   - **Builds on:** Slices 1–2. The declarative SPI already produces a uniform "name + parameter map" node, so the contributed-kind side is coordinate-ready; this slice moves the built-in slots (`models`/`enums`/`compositeTypes`) into `entries` too.
   - **Hands to:** A PSL AST whose entity-coordinate system matches the contract IR's, so the ADR (Slice 4) describes one coordinate shape across both trees.
   - **Focus:** `PslNamespace` (`psl-ast.ts`), the generic parser/printer (write/read `entries`), `sqlSchemaIrToPslAst`, PSL-AST consumers + tests. Framework-internal storage-shape change; extension descriptors are unaffected (they describe nodes, not storage).

4. **Slice `adr-and-close-out`** — Linear: [TML-2806](https://linear.app/prisma-company/issue/TML-2806)
   - **Outcome:** ADR 126 revised from the `parseFn`/`emitFn` function SPI to the declarative descriptor decision actually shipped; three-layer-extensibility ADR/section lands (IR / lowering / declarative parsing+printing, tied by `discriminator`); subsystem docs reference it; `AGENTS.md` `entities`→`entityTypes` doc-bug fixed; `projects/target-contributed-psl-blocks/` deleted and references scrubbed.
   - **Builds on:** Slices 1–3 merged — the ADR codifies the as-shipped substrate.
   - **Hands to:** Durable architectural record; project directory removed; tree clean.
   - **Focus:** Markdown-only. ADR 126 revision, three-layer ADR, subsystem docs, the one-line `AGENTS.md` fix, project-dir deletion.

## Closed (not delivered)

- **Slice `enum-migration`** — Linear: [TML-2805](https://linear.app/prisma-company/issue/TML-2805) — Closed. `enum` stays framework-parsed (an application/domain-plane concept, not a Postgres feature). Cross-target enum support is the independent **enums-as-domain-concept** project ([PR #748](https://github.com/prisma/prisma-next/pull/748); TML-2850–2853).

## Relationship to adjacent work

- **PR #718 (function-SPI cut)** — superseded; in draft; mechanism cherry-picked into Slice 1/2; branch preserved.
- **PR #745 / TML-2500 (cross-contract-space references)** — merged; `ref` scope resolves against its coordinate model. Not blocking.
- **PR #748 / enums-as-domain-concept (TML-2850–2853)** — independent. An `option` parameter is an authoring-time constraint, not a domain enum; neither project depends on the other.

## Sequencing rationale

Slice 1 (read: descriptor + parse/validate/lower) before Slice 2 (write: printer + infer) because the printer renders the AST node the parser produces — the descriptor shape must settle first, and the codec literal hooks split naturally (parse in 1, print in 2) along the direction each slice needs. Slice 3 (entries) after the SPI is read/write-complete: the declarative uniform node makes the contributed-kind side coordinate-ready, leaving only the built-in slots to move, and doing it as its own slice keeps that framework-wide reshape reviewable on its own. Slice 4 (ADR + close-out) last so the ADR records the substrate as actually shipped, and the project-dir deletion runs after every other slice merges.
