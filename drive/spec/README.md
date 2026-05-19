# drive/spec — project-context for spec authoring

Loaded by `drive-specify-project` and `drive-specify-slice`. Holds prisma-next's spec-authoring conventions — template extensions and tracker / branch linkage.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

Spec authoring reads:

- [`drive/calibration/patterns.md § Edge-case patterns`](../calibration/patterns.md#edge-case-patterns-example-mapping) — Example-Mapping prompts the slice author walks during spec-shaping
- [`drive/calibration/failure-modes.md § Slice-shape scope traps`](../calibration/failure-modes.md#slice-shape-scope-traps) — recurring scope-creep patterns caught at triage / spec time
- [`drive/calibration/dor.md`](../calibration/dor.md) — slice-DoR overlay (Linear issue, branch, parent-branch items)
- [`drive/calibration/dod.md`](../calibration/dod.md) — slice-DoD overlay (plan-side items live there)

## Required sections (beyond template)

In addition to the canonical project-spec / slice-spec templates, this repo expects:

- **Contract-impact section** for any spec that touches the contract surface (`packages/0-shared/contract/**`, `packages/1-framework-core/**`). Names the contract entities affected, the new / changed kinds, the migration plan for downstream consumers.
- **Adapter-impact section** for any spec that affects target adapters (`packages/3-targets/**`). Names which adapters are affected (postgres / sqlite / mongo / etc.).
- **ADR pointer** for any architectural shift. Either link an existing ADR or commit to authoring one as part of the project's close-out.

## When this file changes

Append when a new required section emerges from a retro (a spec consistently missed a piece of context, and the team agreed a section header should prompt for it). For new edge-case patterns, new scope traps, or new DoR/DoD items: edit the matching file under [`drive/calibration/`](../calibration/) — never duplicate calibration here.
