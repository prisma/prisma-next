# ADR 150 — Family‑Agnostic CLI and Pack Entry Points

## Status
Accepted

## Context

We want a single, simple way for applications to declare their target family, target, adapter, and extensions in a config file that both emit (migration plane) and DB‑connected commands (runtime plane) can consume. The CLI must remain family‑agnostic and must not import family code or SQL‑specific types. Previously, CLI flags (`--adapter`, `--extensions`) and ad‑hoc discovery created ambiguity and friction.

## Decision

1. Config‑only input
- Apps declare everything in `prisma-next.config.ts`. The CLI imports only this config module; it never imports packs directly or reads JSON manifests from disk.

2. Explicit pack entrypoints
- Each pack exposes two entrypoints:
  - `/cli`: default‑exports IR‑only descriptors for tooling and callable helpers; safe for emit.
  - `/runtime`: exports runtime factories/types; used only by DB‑connected commands or app runtime.

3. Family‑agnostic CLI + family‑provided helpers
- The config’s `family` export includes:
  - `hook: TargetFamilyHook` (used by `@prisma-next/emitter`)
  - `assembleOperationRegistry`, `extractCodecTypeImports`, `extractOperationTypeImports`
- The CLI calls these helpers to assemble inputs for emit; manifests remain opaque to the CLI.

4. TargetFamilyHook validates operator registry
- The emitter passes `ctx.operationRegistry` and `ctx.extensionIds` to `TargetFamilyHook.validateTypes`.
- Family hooks validate operator signatures, lowering.targetFamily, arg/return kinds, and typeId namespaces.

5. Deterministic composition rules
- `extensionIds` order: `[adapter.id, target.id, ...extensions.map(e => e.id)]` (dedupe, stable order preserved).
- Type imports: merge and dedupe `types.codecTypes.import` and `types.operationTypes.import` across adapter/target/extensions.
- Operation manifests: union and convert to signatures; resolve conflicts deterministically (warn on overwrite).

6. Flags removed
- `--adapter` and `--extensions` are removed (may be deprecated briefly). No discovery; config is the single source of truth.

## Consequences

Positive
- CLI remains family‑agnostic; plane boundaries are respected.
- Config is deterministic, reviewable, and tree‑shakeable (/cli vs /runtime).
- Families own typing, assembly, and validation via TargetFamilyHook.

Trade‑offs
- Requires families to provide helper functions in their `/cli` exports.
- Slightly more structure in pack publishing (two entrypoints).

## Implementation Sketch

1) Add config loader: loads TS module and returns config (unknown).
2) Move SQL pack assembly/types under SQL family tooling and re‑export helpers from `@prisma-next/family-sql/cli`.
3) Update emit to read helpers from `config.family`, assemble inputs, and call emitter with `family.hook`.
4) Update docs and examples; remove flags.

## References
- ADR 005 — Thin Core, Fat Targets
- ADR 007 — Types Only Emission
- Package Layering Guide
- Project Brief — CLI Support for Extension Packs
