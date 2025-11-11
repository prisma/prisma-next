## Slice 20 — Delegate Operation Assembly to Target-Family Hook (Domain: Framework+SQL, Layers: tooling+core, Planes: migration+shared)

### Context
- We separated concerns so that:
  - `@prisma-next/sql-operations` is a shared, pure model (SqlLoweringSpec, SqlOperationSignature, registry helpers).
  - Pack discovery/loading and manifest IO are tooling concerns (CLI/emitter).
- Remaining question: Who owns deserialization (manifest → OperationSignature) and registry assembly? Prior drafts put this logic into Framework tooling, but that makes the emitter aware of SQL. That’s inverted: the emitter must remain target-family agnostic.

### Decision
- Extend the Target-Family Hook SPI so each family (SQL, document, etc.) owns:
  - Deserialization of its operation manifests into family-specific OperationSignature.
  - Construction/registration of an OperationRegistry for that family.
- The emitter delegates to the hook for operation registry assembly. The emitter loops packs, provides them to the family hook, and receives a ready-to-use registry.

### Goals
1. Keep the emitter family-agnostic: no SQL imports, no awareness of lowering templates.
2. Keep `sql-operations` shared and pure (types + registry helpers only).
3. Make operation assembly (deserialization + registration) a family concern, behind the hook.
4. Preserve clean layering: tooling (emitter) → shared (core + family model) and family hook implementation.

### Non-Goals
- Redesigning the core operation model (`@prisma-next/operations`).
- Changing pack or manifest formats.
- Implementing migration engines.

### SPI Additions (authoritative)
- In `packages/framework/tooling/emitter/src/target-family.ts` extend the hook:
```ts
import type { OperationRegistry, OperationSignature as CoreOpSig } from '@prisma-next/operations';

export interface TargetFamilyHook<FamilyOpSig extends CoreOpSig = CoreOpSig> {
  // existing
  id: string;
  validateTypes(ir: ContractIR, packs: readonly ExtensionPackManifest[]): void;
  validateStructure(ir: ContractIR): void;
  generateContractTypes(ir: ContractIR, packs: readonly ExtensionPack[]): string;

  // new — operations
  operations: {
    createRegistry(): OperationRegistry<FamilyOpSig>;
    /** Deserialize a single operation manifest into a family op signature */
    toSignature(m: OperationManifestLike): FamilyOpSig;
    /**
     * Assemble a registry from packs. Emitter delegates to this; implementation remains family-specific.
     */
    assembleFromPacks(packs: readonly ExtensionPack[]): OperationRegistry<FamilyOpSig>;
  };
}

export type OperationManifestLike = {
  readonly for: string;
  readonly method: string;
  readonly args: readonly Array<{ kind: 'typeId' | 'param' | 'literal'; type?: string }>;
  readonly returns: { kind: 'typeId'; type: string } | { kind: 'builtin'; type: 'number'|'boolean'|'string' };
  readonly lowering?: unknown; // family-defined; SQL will supply template+strategy
  readonly capabilities?: readonly string[];
};
```

### Family Implementation (SQL)
- In `packages/targets/sql/emitter/src/index.ts` (or a nearby module), implement the new `operations` block using shared surfaces:
  - Types from `@prisma-next/sql-operations` (SqlLoweringSpec, SqlOperationSignature) and `@prisma-next/operations` (registry API).
  - Implementation details:
    - `createRegistry()` → `createOperationRegistry()` from core ops, typed as `OperationRegistry<SqlOperationSignature>`.
    - `toSignature(m: OperationManifestLike)` → map to `SqlOperationSignature` (validate args/returns; add `lowering: { targetFamily: 'sql', ... }`).
    - `assembleFromPacks(packs)` →
      - Iterate `pack.manifest.operations`
      - Validate structure (optional Arktype within the family impl)
      - Convert each via `toSignature` and `register` into a fresh registry
      - Return the registry

### Emitter Responsibilities (Framework)
- Emitter remains a pure compiler from IR to artifacts. For ops, it simply:
  - Calls `hook.operations.assembleFromPacks(packs)` to obtain a family registry
  - Uses the registry in lowering/generation as it already does
  - No direct imports from SQL or assumptions about lowering formats

### Why this is better
- Clear ownership: Each family knows how to interpret its own manifests into signatures. The emitter remains blind to family details.
- Shared purity: `@prisma-next/sql-operations` stays clean (no IO, no pack types), and runtime/lanes import only types from shared.
- Extensibility: Adding a new target family only requires implementing the hook; emitter code does not change.

### Migration Plan
1. Extend TargetFamilyHook SPI with `operations` as above.
2. Implement `operations` in SQL hook using shared types (`@prisma-next/sql-operations`, `@prisma-next/operations`).
3. Remove `assembleOperationRegistry` from `@prisma-next/sql-operations` (see Slice 19); keep `createSqlOperationRegistry` and `register` only.
4. Update emitter to call `hook.operations.assembleFromPacks(packs)` and stop any direct mapping/assembly.
5. Update tests:
   - SQL family tests cover `toSignature` mapping and `assembleFromPacks` logic
   - Emitter tests pass prebuilt registries produced via the hook
   - sql-operations tests cover type integrity and registry helpers only
6. Run `pnpm lint:deps`; ensure no runtime→migration violations; confirm emitter has no SQL imports.

### Acceptance Criteria
- Emitter compiles with zero SQL imports; it calls the family hook for operation assembly.
- SQL family hook implements `operations.createRegistry`, `operations.toSignature`, and `operations.assembleFromPacks` using shared types.
- `@prisma-next/sql-operations` exports only model + registry helpers (no assembly).
- `pnpm lint:deps` passes after removing runtime→migration exceptions related to sql-operations.

### Risks & Mitigations
- SPI change ripple: minimize by defaulting `operations` block for existing families; add SQL first, then migrate others.
- Test churn: provide shared fixtures for manifests; reuse mapping logic in tests.
- Docs drift: update AGENT_ONBOARDING and Architecture Overview to describe the new hook responsibilities.

