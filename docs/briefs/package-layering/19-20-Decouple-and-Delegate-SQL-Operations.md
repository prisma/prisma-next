## Slice 19+20 — Decouple SQL Operations From Assembly and Delegate to Target Hook

Domain: SQL family + Framework
Layers: shared (core, family model) + tooling (packs/emitter)
Planes: shared + migration

### Context
- `@prisma-next/sql-operations` currently mixes:
  1) SQL operation model (lowering + signature + registry helpers)
  2) Assembly from ExtensionPack manifests (pack IO/iteration + mapping)
- Runtime (lanes/sql-runtime) imports operation shapes. When `sql-operations` is migration-plane, these imports violate plane rules; when shared, its pack/assembly dependencies bleed tooling concerns into shared code.
- The emitter must be family-agnostic and deterministic: turn Contract IR into artifacts. It should not perform pack discovery/loading or know SQL specifics.

### Problems
1. Plane violations: runtime imports from migration-plane packages.
2. Mixed responsibilities: shared model code depends on tooling types/IO.
3. Emitter coupling: emitter aware of SQL concepts if it assembles operations itself.

### Decisions
1. Make `@prisma-next/sql-operations` a shared, pure model package. It exports only SQL operation types and registry helpers; no manifests, no packs, no IO.
2. Extend the Target-Family Hook SPI so each family owns operation deserialization and registry assembly. The emitter delegates to the hook to obtain a ready registry from packs.

### Goals
- Keep shared code (sql-operations) side-effect free and usable by both planes.
- Keep the emitter family-agnostic; it never imports SQL types directly.
- Move pack discovery/loading and manifest resolution to tooling; move deserialization/assembly to the family hook.
- Remove runtime→migration Dependency Cruiser exceptions related to operations.

### Non-Goals
- Redesign operation manifests or extension pack format.
- Change the framework’s target-agnostic operations model (`@prisma-next/operations`).
- Implement a migrations engine.

### Deliverables
- `@prisma-next/sql-operations` (shared; `packages/sql/operations`)
  - Types: `SqlLoweringSpec`, `SqlOperationSignature` (extends Core), `SqlOperationRegistry` (alias)
  - Helpers: `createSqlOperationRegistry()`, `register(reg, sig)`
  - Removed: any `assembleOperationRegistry(...)` that consumes packs/manifests.

- Target-Family Hook SPI (framework tooling)
  - Extend hook with an `operations` block (family-specific):
    - `createRegistry(): OperationRegistry<FamilyOpSig>`
    - `toSignature(m: OperationManifestLike): FamilyOpSig`
    - `assembleFromPacks(packs: readonly ExtensionPack[]): OperationRegistry<FamilyOpSig>`

- SQL family hook implementation
  - Implements `operations` using shared `@prisma-next/sql-operations` and core ops.
  - Performs structural validation of manifests (optional Arktype) before mapping.

- Pack Manager (Framework tooling, migration plane)
  - Location: `packages/framework/tooling/packs` (e.g., `src/sql-ops.ts`)
  - Responsibilities:
    - discoverPacks(cwd): filesystem/config discovery → `ExtensionPack[]`
    - validateManifests(packs): structural validation (Arktype) → `ValidatedManifest[]`
    - toTypesImportSpecs(packs): extract codec/operation type imports for `contract.d.ts`
    - buildOperationRegistry(packs, hook): delegate to `hook.operations.assembleFromPacks(packs)`; return registry
  - Boundaries: tooling-only; no SQL imports (family specifics are in the hook)

### Authoritative Interfaces
- Shared model (`@prisma-next/sql-operations`):
```ts
import type { OperationRegistry, OperationSignature as CoreOpSig } from '@prisma-next/operations';

export interface SqlLoweringSpec { readonly targetFamily: 'sql'; readonly strategy: 'infix'|'function'; readonly template: string }
export interface SqlOperationSignature extends CoreOpSig { readonly lowering: SqlLoweringSpec }
export type SqlOperationRegistry = OperationRegistry<SqlOperationSignature>;

export function createSqlOperationRegistry(): SqlOperationRegistry;
export function register(reg: SqlOperationRegistry, sig: SqlOperationSignature): void;
```

- Hook SPI (framework tooling):
```ts
export type OperationManifestLike = {
  readonly for: string;
  readonly method: string;
  readonly args: readonly Array<{ kind: 'typeId'|'param'|'literal'; type?: string }>;
  readonly returns: { kind: 'typeId'; type: string } | { kind: 'builtin'; type: 'number'|'boolean'|'string' };
  readonly lowering?: unknown; // family-defined; SQL supplies { strategy, template }
  readonly capabilities?: readonly string[];
};

export interface TargetFamilyHook<FamilyOpSig extends CoreOpSig = CoreOpSig> {
  id: string;
  validateTypes(ir: ContractIR, packs: readonly ExtensionPackManifest[]): void;
  validateStructure(ir: ContractIR): void;
  generateContractTypes(ir: ContractIR, packs: readonly ExtensionPack[]): string;
  operations: {
    createRegistry(): OperationRegistry<FamilyOpSig>;
    toSignature(m: OperationManifestLike): FamilyOpSig;
    assembleFromPacks(packs: readonly ExtensionPack[]): OperationRegistry<FamilyOpSig>;
  };
}
```

### Emitter Responsibilities
- Emitter compiles IR to artifacts and delegates operation assembly:
  - Given `packs` and a `hook`, call Pack Manager to obtain normalized inputs and/or call `hook.operations.assembleFromPacks(packs)` to obtain a registry.
  - Use the registry while remaining blind to SQL specifics.

### TDD Milestones (with review gates)

M1 — Shared SQL Operations Model
- Tests (sql/operations):
  - `createSqlOperationRegistry` returns typed registry; `register` adds signatures
  - No references to `ExtensionPack` or pack types (grep guard)
- Impl: add types + helpers; remove any assembly
- Review gate: shared package is side-effect free and imports compile in runtime packages

M2 — Hook SPI + SQL Hook Operations
- Tests (SQL hook):
  - `toSignature` maps valid manifests → `SqlOperationSignature`; rejects invalid structures with helpful errors
  - `assembleFromPacks` registers all operations from multiple packs into a fresh registry
- Impl: extend SPI; implement SQL hook’s operations block using shared types; add optional validators
- Review gate: emitter has zero SQL imports; hook composes shared packages correctly

M3 — Pack Manager (Tooling)
- Tests (packs):
  - `discoverPacks` finds fixture packs
  - `validateManifests` catches structural issues
  - `toTypesImportSpecs` extracts codec/operation type imports
  - `buildOperationRegistry` delegates to `hook.operations.assembleFromPacks`
- Impl: add `packages/framework/tooling/packs` with the minimal API; ensure boundaries (no SQL imports)
- Review gate: emitter uses Pack Manager outputs; structure is clean (tooling → shared)

M4 — Integration + Dep-Cruiser Cleanup
- Tests: emitter integration tests green using Hook + Pack Manager; runtime/lane tests still green
- Config: map `packages/sql/operations/**` to shared plane; remove runtime→migration exceptions for operations; run `pnpm lint:deps`
- Docs sweep: Architecture Overview + AGENT_ONBOARDING updated for new responsibilities
- Review gate: layering is enforced; no runtime-plane imports from migration-plane code

### Affected Files (initial extraction)
- `packages/targets/sql/operations/src/index.ts`
  - Remove assembly from packs; export only types + registry helpers.
- `packages/targets/sql/emitter/src/index.ts` (or a sibling)
  - Implement `hook.operations` using shared types.
- `packages/framework/tooling/emitter/src/target-family.ts`
  - Extend SPI as above.
- Runtime-plane imports (remain the same path but now legal once sql-operations is shared):
  - `packages/sql/lanes/relational-core/src/ast/types.ts:2` (LoweringSpec)
  - `packages/sql/lanes/relational-core/src/types.ts:4` (LoweringSpec)
  - `packages/sql/lanes/relational-core/src/operations-registry.ts:5` (SqlOperationSignature)
  - `packages/sql/sql-runtime/src/sql-context.ts:4` (SqlOperationSignature)

### Architecture & Dep-Cruiser Changes
- Map `packages/sql/operations/**` to domain sql, layer core, plane shared in `architecture.config.json`.
- Remove runtime→migration exceptions related to sql-operations once imports are clean.
- Keep CLI and lanes→runtime exceptions until their own slices land.

### Migration Plan (staged)
1. Extend TargetFamilyHook SPI and implement SQL hook `operations` (createRegistry, toSignature, assembleFromPacks).
2. Remove `assembleOperationRegistry` from `@prisma-next/sql-operations`; publish only model + registry helpers.
3. Update emitter to delegate to `hook.operations.assembleFromPacks(packs)`; stop any direct mapping.
4. Reclassify/move `sql-operations` to shared plane in `architecture.config.json`.
5. Re-run `pnpm lint:deps` and remove runtime→migration exceptions for operations.
6. Update docs (Architecture Overview, AGENT_ONBOARDING) to reflect: emitter is family-agnostic; family hook assembles operations; sql-operations is shared.

### Acceptance Criteria
- Emitter has zero SQL imports; operation assembly delegated to family hook.
- `@prisma-next/sql-operations` is shared and contains only types + registry helpers.
- Runtime-plane code imports only shared surfaces; `pnpm lint:deps` passes with related exceptions removed.

### Risks & Mitigations
- SPI change ripple: implement SQL first; add default no-op `operations` for other families until migrated.
- Test churn: provide shared fixtures for manifests; unit-test hook mapping independently of emitter.
- Docs drift: sweep references that imply emitter assembles operations.
