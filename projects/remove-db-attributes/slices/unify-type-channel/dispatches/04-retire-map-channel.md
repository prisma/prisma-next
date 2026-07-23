# D4 — Hard cut: retire the scalarTypeDescriptors map channel

**Slice plan:** `projects/remove-db-attributes/slices/unify-type-channel/plan.md` · **Tier:** mid · **Branch:** `tml-2985-unify-type-channel`

## Task

D1–D3 (`7ec6d817`, `7e5857cf`, `866abd45c`) moved every consumer (SQL provider, symbol table, LSP, mongo provider) onto the unified `AuthoringContributions.type` namespace. Nothing reads the `scalarTypeDescriptors` map channel anymore. This dispatch deletes it — the channel's declaration, assembly, context threading, adapter maps, and its map-shaped validation — and re-points codec-id validation at the namespace.

## Outcome (property statement)

The map channel ceases to exist end-to-end, **such that** the unified namespace is the *only* representation of scalar types in production code (no dual-shape remnant under any name — F1), and codec-id validation still rejects a zero-arg constructor whose `output.codecId` names an unregistered codec at stack-composition time with an error naming the type and codec.

## In (delete or re-point)

- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts` — `assembleScalarTypeDescriptors` deleted; `validateScalarTypeCodecIds` re-shaped to walk top-level zero-arg constructors (via `collectScalarTypeConstructors`) instead of the map — keep the equivalent error quality (type name + codec id); rename if the old name no longer fits.
- `ComponentMetadata.scalarTypeDescriptors` field (`framework-components/src/shared/framework-components.ts` or wherever it's declared) — deleted.
- `packages/1-framework/1-core/config/src/contract-source-types.ts` — `ContractSourceContext.scalarTypeDescriptors` deleted; delete whatever populates it (grep for the construction site).
- Adapter maps: `postgresScalarTypeDescriptors`/`createPostgresScalarTypeDescriptors` (postgres `control-mutation-defaults.ts` + `exports/control.ts`), sqlite equivalents, mongo `mongoAdapterDescriptor.scalarTypeDescriptors` — deleted.
- Tests that exercised the map channel: migrate assertions onto the namespace equivalents (keep the *claims* — e.g. duplicate-scalar rejection, codec-validation error — alive in namespace form; don't drop coverage).
- D2/D3's parity tests that compare namespace vs legacy map: re-shape to pin literals only (the legacy side of the comparison no longer exists).

## Out

- Any new capability. Native types (slice 2). Any authoring-syntax change. The `scalarTypeCodecIds`/`scalarColumnDescriptors` interpreter-input names introduced by D2/D3 stay.

## Edge cases

| Case | Disposition |
| --- | --- |
| A forgotten reader of `ContractSourceContext.scalarTypeDescriptors` (CLI? codegen? contract.d.ts emitter?) | Grep exhaustively BEFORE deleting (`rg 'scalarTypeDescriptors' packages --type ts` including tests); re-point any straggler onto the namespace; report each one found. |
| Duplicate-scalar rejection coverage | `assembleScalarTypeDescriptors`'s duplicate error dies with it; the namespace path already rejects via D1's contributor attribution — ensure a test still proves it for two adapters contributing the same scalar. |
| Parity-test intent | Byte-identical emission claims survive as pinned-literal assertions; note in the test why the legacy comparison is gone. |
| Destructive git operations | **Forbidden**; commit with `git commit -s`. |
| mongodb-memory-server on nixos | Pre-existing environmental failure; name skipped suites, don't fix the environment. |

## Completed when

1. `rg 'scalarTypeDescriptors' packages --type ts` returns **zero hits including tests** (the name survives nowhere; renamed interpreter inputs from D2/D3 don't count — they're different names).
2. Codec-id validation test proves the namespace-walking check fires (unregistered codec → error naming type + codec).
3. `pnpm typecheck`, per-touched-package lint + tests, `pnpm test:packages`, `pnpm fixtures:check` zero drift, `pnpm lint:deps` clean.

## Report back

Everything deleted (by symbol); stragglers found in the pre-delete grep and how each was re-pointed; validation reshaping; gates run + results; F1/F12/F14 checked; commit SHA.
