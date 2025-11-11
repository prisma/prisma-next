## Slice 18 — Extract SQL Operations to Shared Plane (Domain: SQL family, Layer: core, Plane: shared)

### Context
- `@prisma-next/sql-operations` currently lives under the SQL family "targets" ring (migration plane). It defines SQL operation vocabulary: a SQL-specific `LoweringSpec`, a SQL-flavored `OperationSignature` extending the framework’s core model, and an assembly function that builds an `OperationRegistry` from extension pack manifests.
- Runtime-plane packages (lanes and sql-runtime) import operation shapes from `@prisma-next/sql-operations`:
  - `LoweringSpec` in AST and lane types
  - `OperationSignature` in the relational-core operations registry
- With dep-cruise runtime→migration exceptions removed, these imports become violations: runtime cannot import from migration plane.
- We also agreed in Slice 14 to centralize SQL family shared surfaces (types/validators/factories) in the shared plane. Operations fit the same pattern: model + type declarations must be available to both planes; IO and pack loading belong to tooling.

### Problems
1. Plane violation: runtime imports operation types from a migration-plane package.
2. Mixed responsibilities: `sql-operations` both defines the model and assembles from extension packs (tooling concern).
3. Fragmented surfaces: SQL family shared contracts live in `@prisma-next/sql-contract`, while operation shapes sit elsewhere.

### Decision
- Re-scope `@prisma-next/sql-operations` as a shared-plane SQL family package that contains:
  - SQL `LoweringSpec` and SQL `OperationSignature` (types only).
  - A pure, data-only `OperationRegistry` assembly (from plain manifest objects), no IO.
  - Optional Arktype validators for operation manifests (side-effect free).
- Extract manifest reading/resolution from extension packs into emitter/CLI (tooling, migration plane). Tooling converts packs → plain manifest objects and calls the shared assembly.

### Goals
1. Make runtime-plane imports legal by moving SQL operation shapes to the shared plane.
2. Keep IO/pack resolution in tooling (emitter/CLI), not in shared code.
3. Remove runtime→migration dep-cruise exceptions related to operation imports.

### Non-Goals
- Changing the framework’s target-agnostic operations model (`@prisma-next/operations`).
- Redesigning extension pack manifests.
- Implementing a migrations engine.

### Target End-State
- `@prisma-next/sql-operations` (shared plane) exports:
  - `LoweringSpec` (SQL)
  - `OperationSignature` = `CoreOperationSignature & { lowering: LoweringSpec }`
  - `createOperationRegistry`, `OperationRegistry` (from `@prisma-next/operations`)
  - `assembleOperationRegistry(manifests: readonly OperationManifestLike[])`
  - (optional) `validateOperationManifest` / `validateOperationManifests` (Arktype)
- Emitter/CLI (tooling) exports:
  - `assembleOperationRegistryFromPacks(packs: ExtensionPack[])`: reads `pack.manifest.operations`, validates with shared validators, maps into plain manifests, then calls `sql-operations.assembleOperationRegistry`.
- Lanes/runtime:
  - Import `LoweringSpec` and `OperationSignature` from shared `@prisma-next/sql-operations`.
  - Do not import any migration-plane code.

### Package Topology and Ownership
- Shared plane (SQL family): `packages/sql/operations/**` → `@prisma-next/sql-operations`
  - Types + pure assembly, no IO.
- Tooling (Framework/emitter): `packages/framework/tooling/emitter/**`
  - Pack reading/resolution → maps pack manifests to plain specs and invokes shared `assembleOperationRegistry`.
- Framework core: `@prisma-next/operations` remains the source of target-agnostic operation model utilities (`OperationRegistry`, `OperationSignature` base, `ReturnSpec`, `ArgSpec`).

### Interfaces and Types (authoritative)
- `LoweringSpec`
  - `{ readonly targetFamily: 'sql'; readonly strategy: 'infix' | 'function'; readonly template: string }`
- `OperationSignature`
  - `import type { OperationSignature as CoreOpSig } from '@prisma-next/operations'`
  - `export interface OperationSignature extends CoreOpSig { readonly lowering: LoweringSpec }`
- `OperationManifestLike` (shared)
  - `{ for: string; method: string; args: readonly Array<{ kind: 'typeId' | 'param' | 'literal'; type?: string }>; returns: ({ kind: 'typeId'; type: string } | { kind: 'builtin'; type: 'number' | 'boolean' | 'string' }); lowering: { strategy: 'infix' | 'function'; template: string }; capabilities?: readonly string[] }`
- `assembleOperationRegistry(manifests: readonly OperationManifestLike[]): OperationRegistry`
  - Pure function: transforms manifests → signatures; registers in a registry created via `@prisma-next/operations`.

### Manifest Validators (optional, shared)
- Arktype schemas co-located in `sql-operations` for structural validation of `OperationManifestLike` and arrays thereof.
- Emitter/CLI may use these validators before calling `assembleOperationRegistry`.

### Affected Imports (exact files)
- Update runtime-plane imports to shared `sql-operations`:
  - `packages/sql/lanes/relational-core/src/ast/types.ts:2`
    - Before: `import type { LoweringSpec } from '@prisma-next/sql-operations'` (migration plane package)
    - After:  Same path, but ensure the package is shared; if path changes, `@prisma-next/sql-operations` still applies.
  - `packages/sql/lanes/relational-core/src/types.ts:4`
    - Before: `import type { LoweringSpec } from '@prisma-next/sql-operations'`
    - After:  same, now legal.
  - `packages/sql/lanes/relational-core/src/operations-registry.ts:5`
    - Before: `import type { OperationSignature } from '@prisma-next/sql-operations'`
    - After:  same, now legal.
  - `packages/sql/sql-runtime/src/sql-context.ts:4`
    - Before: `import type { OperationSignature } from '@prisma-next/sql-operations'`
    - After:  same, now legal.
- Update emitter/CLI to go through shared assembly:
  - Replace any direct `assembleOperationRegistry(packs)` with: extract manifests from packs, validate, then call shared `assembleOperationRegistry(manifests)`.

### Architecture Config Changes
- Move/reclassify sql-operations to shared plane:
  - Add/replace entry:
    ```json
    { "glob": "packages/sql/operations/**", "domain": "sql", "layer": "core", "plane": "shared" }
    ```
  - Remove/adjust any mapping for `packages/targets/sql/operations/**`.

### Dependency Cruiser Changes
- After imports are updated and package reclassified/moved:
  - Remove runtime→migration exceptions:
    - `isSqlRuntimeOrAdaptersToTargets`
    - `isExtensionsToSqlTargets`
  - Keep CLI and lanes→runtime exceptions for their respective slices.

### Testing & Verification
- Unit tests for shared `assembleOperationRegistry` using plain manifests (no pack IO).
- Emitter tests update to use pack→manifest mapping + shared assembly.
- Runtime/lane tests compile and run with shared imports.
- `pnpm lint:deps` passes with runtime→migration exceptions removed.

### Migration Plan (staged)
1. Create/move `packages/sql/operations` with shared types + pure assembly; add validators.
2. Update `architecture.config.json` to map `packages/sql/operations/**` to shared plane.
3. Update emitter/CLI to extract manifests and call shared assembly; avoid importing pack types in shared.
4. Update runtime-plane imports (files listed above) to continue importing from `@prisma-next/sql-operations` (now shared).
5. Run `pnpm lint:deps`; remove runtime→migration exceptions; re-run.
6. Docs sweep: Architecture Overview and AGENT_ONBOARDING reflect `sql-operations` as shared; emitter handles pack IO.

### Acceptance Criteria
- `@prisma-next/sql-operations` is shared (types + pure assembly). No IO or pack imports.
- Emitter/CLI owns pack reading and passes plain manifests to shared assembly.
- Lanes/runtime import only from shared packages (`@prisma-next/sql-operations`, `@prisma-next/operations`).
- `pnpm lint:deps` is green with runtime→migration exceptions removed.

### Risks & Mitigations
- Scope creep: keep `sql-operations` strictly type + pure assembly; validators optional but pure.
- Import drift: add CI grep to block new imports from tooling/migration in runtime-plane code.
- Docs confusion: add a one-liner in package README clarifying shared vs tooling responsibilities.

### Appendix — Grep Checklist
- Find runtime imports of `@prisma-next/sql-operations`:
  - `rg -n "from '@prisma-next/sql-operations'" packages/sql packages/extensions`
- Confirm `sql-operations` has no pack/tooling imports:
  - `rg -n "from '@prisma-next/emitter'|fs|path" packages/sql/operations/src`
- Verify dep-cruise exceptions can be removed and `pnpm lint:deps` passes.

