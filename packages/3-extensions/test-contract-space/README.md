# @prisma-next/extension-test-contract-space

Private workspace fixture for the **contract-space mechanism** described in
[ADR 211 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md).
Not published.

## What this exists for

The framework's per-space planner / runner / verifier needs at least one
schema-contributing extension to exercise end-to-end. Real consumers
(cipherstash, pgvector) land in later milestones; this package is the
purpose-built fixture that exercises:

- The `contractSpace` descriptor field on `SqlControlExtensionDescriptor`.
- Per-space migration emission under `migrations/<space-id>/`.
- Pinned per-space artefacts (`contract.json`, `contract.d.ts`, `refs/head.json`).
- The verifier's orphan-marker / orphan-pinned-dir / declared-but-unmigrated cases.
- The `node_modules`-deleted scenario (apply / verify must succeed reading
  only the user repo, no descriptor import).

The same module-graph descriptor-import path a real extension uses is
exercised here, so any regression in the loader or the bundler-friendly
authoring surface surfaces against this fixture.

## Why a real workspace package

A pure unit-test fixture would not exercise the descriptor module loader,
the workspace `extensionPacks` plumbing, or the typecheck of an extension's
`contractSpace` against the in-tree types. Mirroring `pgvector`'s package
shape keeps this fixture honest end-to-end.
