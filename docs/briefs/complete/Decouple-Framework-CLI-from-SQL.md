# Brief: Decouple framework/cli from SQL

## Problem
- `@prisma-next/cli` (framework/tooling/cli) still imports SQL-family packages directly, violating domain boundaries and requiring explicit exceptions in `dependency-cruiser.config.mjs`.
- This tight coupling prevents adding other target families and complicates maintenance/testing.

## Goals
- Make `@prisma-next/cli` target-family agnostic. It should only depend on core framework types and a pluggable family descriptor loaded from app config.
- Move all SQL-specific registry assembly, type import extraction, and contract validation into the SQL family packages.
- Remove CLI→SQL exceptions from `dependency-cruiser.config.mjs` while keeping layering rules intact.
- Keep the existing CLI UX and config surface stable.

## Non‑Goals
- No runtime behavior change to SQL lanes/ORM.
- No changes to extension pack manifest schema beyond what the CLI already uses.
- No change to migration or runtime executors beyond what’s necessary to expose family hooks.

## Current State (hotspots)
- SQL type imports and validation in CLI:
  - packages/framework/tooling/cli/src/commands/emit.ts:1 — imports `@prisma-next/sql-contract/types`
  - packages/framework/tooling/cli/src/commands/emit.ts:5 — imports `validateContract` from `@prisma-next/sql-contract-ts/contract`
- SQL operation registry assembly living in framework CLI:
  - packages/framework/tooling/cli/src/pack-assembly.ts:1 — imports `@prisma-next/sql-operations`
  - Duplicates functionality that exists in SQL family packages under `packages/sql/tooling/**`.
- Dependency‑cruiser exceptions enable CLI→SQL crossings:
  - dependency-cruiser.config.mjs:75-108 — exceptions for CLI importing SQL targets/tooling/authoring/operations.

## Design Overview
Introduce a single indirection layer via the existing FamilyDescriptor and move remaining SQL concerns behind it.

1) Extend FamilyDescriptor API
- Add contract validation and normalization hooks so CLI doesn’t import SQL types directly.
- Proposed additions:
  - `validateContractIR(contractJson: unknown): unknown` — returns family’s validated ContractIR (without mappings)
  - Optional `stripMappings(contract: unknown): unknown` — default no‑op; SQL can override

2) Use family descriptor everywhere in CLI
- emit command uses only `config.family` for:
  - assembling operation registry
  - extracting codec/operation type imports
  - validating/normalizing contract IR
  - family hook passed to emitter

3) Relocate SQL‑specific helpers to SQL family packages
- Generic assembly logic (looping over descriptors) moved to `packages/framework/tooling/cli/src/pack-assembly.ts`.
- Family-specific conversion (manifest → signature) delegated to `family.convertOperationManifest()` in SQL family CLI package.
- `@prisma-next/sql-tooling-assembly` package removed.

4) Update examples/tests to consume family exports
- Replace imports of framework `pack-assembly` with `@prisma-next/family-sql/control` or use the config path.

5) Remove dep‑cruiser exceptions
- After code changes land, delete CLI→SQL exceptions:
  - isCliToSqlTargets, isCliToSqlTooling, isCliToSqlAuthoring, isCliToSqlOperations branches
  - Rely on plane/domain rules and family indirection instead

## Detailed Changes
- Framework CLI
  - packages/framework/tooling/cli/src/commands/emit.ts: remove direct SQL imports; replace with `config.family.validateContractIR` and `config.family.stripMappings` (or built‑in strip if returned IR contains mappings field).
  - packages/framework/tooling/cli/src/pack-assembly.ts: delete file (moved to SQL family) and update all call sites/tests.
  - packages/framework/tooling/cli/src/config-types.ts: extend FamilyDescriptor with `validateContractIR` and optional `stripMappings`.

- SQL Family
  - packages/sql/tooling/cli/src/exports/cli.ts: implement `validateContractIR` and `stripMappings` using `@prisma-next/sql-contract-ts/contract` and contract type shape; keep existing registry/type import assembly wiring.
  - packages/sql/tooling/assembly: no API change; continue to back family methods.

- Dependency rules
  - dependency-cruiser.config.mjs: remove CLI→SQL exceptions and re‑run `pnpm lint:deps` to ensure green.

## Migration Plan
1. Add new methods to FamilyDescriptor and implement them in SQL family package.
2. Refactor CLI `emit.ts` to use new family methods; remove SQL imports.
3. Delete `framework/tooling/cli/src/pack-assembly.ts`; update examples/tests to import from `@prisma-next/family-sql/control` or use config.
4. Run `pnpm build && pnpm test:packages` and fix type fallout.
5. Remove exceptions from `dependency-cruiser.config.mjs`; run `pnpm lint:deps`.
6. Update docs and briefs; confirm examples still function.

## Acceptance Criteria
- `@prisma-next/cli` has no imports from `packages/sql/**`.
- All pack assembly and type import extraction come from the configured family.
- `pnpm lint:deps` passes without CLI→SQL exceptions.
- `pnpm test:packages` and integration tests pass.
- Demo apps and docs reflect new import paths and config‑driven usage.

## Risks & Mitigations
- Test fallout from removing re‑exports in framework CLI — mitigate by updating examples/tests in the same PR.
- Future non‑SQL families may need additional CLI hooks — keep FamilyDescriptor additive and minimal.

## Rollout
- Single PR, but structured commits:
  1) Add FamilyDescriptor hooks and SQL implementation
  2) Refactor CLI to use hooks
  3) Delete framework pack‑assembly and update examples/tests
  4) Remove dep‑cruiser exceptions and verify
  5) Docs updates

## File Hotspots (for implementation)
- packages/framework/tooling/cli/src/commands/emit.ts
- packages/framework/tooling/cli/src/config-types.ts
- packages/framework/tooling/cli/src/pack-assembly.ts
- packages/sql/tooling/cli/src/exports/cli.ts
- dependency-cruiser.config.mjs

