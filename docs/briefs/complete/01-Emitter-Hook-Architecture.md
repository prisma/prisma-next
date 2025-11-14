## Emitter Hook-Based Architecture and Complete Contract.d.ts Generation

### Purpose

Refactor the emitter to a hook-based architecture keyed by `targetFamily` (e.g., SQL, Document), treating adapters as extension packs. Produce canonical `contract.json` and a complete, types-only `contract.d.ts` that exposes the full `Contract` surface (tables, models, mappings) and a `CodecTypes` map for compile-time lane inference.

### Relevant Design Docs

- Architecture Overview: [../Architecture Overview.md](../Architecture%20Overview.md)
- Data Contract (structure, determinism): [../architecture docs/subsystems/1. Data Contract.md](../architecture%20docs/subsystems/1.%20Data%20Contract.md)
- Contract Emitter & Types: [../architecture docs/subsystems/2. Contract Emitter & Types.md](../architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md)
- Query Lanes (Plan model, typing rules): [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- Ecosystem Extensions & Packs: [../architecture docs/subsystems/6. Ecosystem Extensions & Packs.md](../architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md)
- No-Emit Workflow (TS-only authoring): [../architecture docs/subsystems/9. No-Emit Workflow.md](../architecture%20docs/subsystems/9.%20No-Emit%20Workflow.md)
- ADR 010 Canonicalization Rules: [../architecture docs/adrs/ADR 010 - Canonicalization Rules.md](../architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)
- ADR 011 Unified Plan Model: [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 114 Codecs & Branded Types: [../architecture docs/adrs/ADR 114 - Extension codecs & branded types.md](../architecture%20docs/adrs/ADR%20114%20-%20Extension%20codecs%20%26%20branded%20types.md)
- ADR 131 Codec Typing Separation: [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### See Also

- ADR 140 — Package Layering & Target-Family Namespacing: [../architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md](../architecture%20docs/adrs/ADR%20140%20-%20Package%20Layering%20%26%20Target-Family%20Namespacing.md)

### Scope

- One emitter core with `targetFamily` hooks for family-specific concerns; adapters and extension packs provide manifests. Unified typeId model: every column `type` is a fully qualified type ID (`ns/name@version`). The adapter is treated identically to extension packs and appears as the first entry in `contract.extensions.<namespace>`.
- Generate full `contract.d.ts` with:
  - `Contract` type (extending family-specific base, e.g., `SqlContract`)
  - Tables/columns with canonical type IDs
  - Models mapped to JS types via `CodecTypes[typeId].output` (nullability from storage)
  - Mappings (model↔table, field↔column)
  - Exported `CodecTypes` (full maps for MVP) and `LaneCodecTypes` alias

### SPI: Target Family Hook

File: `packages/framework/core-contract/src/types.ts` (shared plane)

**Note**: `TargetFamilyHook`, `ValidationContext`, and `TypesImportSpec` are defined in `@prisma-next/contract/types` (shared plane) to allow both migration-plane (emitter) and shared-plane (control-plane) packages to import them without violating dependency rules. The emitter re-exports these types for backward compatibility.

```ts
export interface ValidationContext {
  readonly operationRegistry?: OperationRegistry;
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface TargetFamilyHook {
  // family id e.g. 'sql'
  readonly id: string;

  // Validate that all type IDs in the contract come from referenced extensions
  validateTypes(ir: ContractIR, ctx: ValidationContext): void;

  // Additional family-specific structural validation over core checks
  validateStructure(ir: ContractIR): void;

  // Generate the complete contract.d.ts content for this family
  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
  ): string;
}
```

**Note**: The emitter is manifest-agnostic. Hooks receive pre-assembled context (`ValidationContext` with `operationRegistry`, `codecTypeImports`, `operationTypeImports`, `extensionIds`), not extension packs. Assembly happens in the family layer and is exposed via the app's config (`family` export) so the CLI remains family‑agnostic.

Core types: `ContractIR` (from `@prisma-next/contract/ir`), `TypesImportSpec`, `ValidationContext`, `TargetFamilyHook` (from `@prisma-next/contract/types`), `EmitOptions`, `EmitResult` (from `@prisma-next/emitter`).

### Treat Adapters as Extension Packs

- Adapters and extension packs share a common descriptor shape on `/cli` entrypoints. For non-CLI consumers, they may also publish a JSON manifest carrying type import hints (e.g., `types.codecTypes.import`).
- The adapter is treated identically to extension packs and appears in `contract.extensions.<adapter-namespace>` (e.g., `extensions.postgres`).
- The adapter is the first extension in the collection, identified by `contract.target`.
  - For CLI consumption, use `/cli` entrypoints (no JSON reads).
- **Note**: Type canonicalization (shorthand → fully qualified IDs) happens at authoring time (PSL parser or TS builder), not during emission. The emitter only validates that all type IDs come from referenced extensions.

### SQL Family Hook (MVP)

File: `packages/sql-target/src/emitter-hook.ts` (or `packages/emitter/src/families/sql.ts`)

- validateTypes: verify all column `type` values are valid type IDs (`ns/name@version`) that come from extensions referenced in `contract.extensions`.
- validateStructure: SQL PK/UK/IDX/FK checks (mirror core SQL validation in `@prisma-next/sql`).
- generateContractTypes:
  - Import `SqlContract`, `TableDef`, `ModelDef` from `@prisma-next/sql/contract-types`.
  - Import `CodecTypes` from adapter/packs.
  - Emit `export type CodecTypes = PgTypes /* & ExtTypes */` and `export type LaneCodecTypes = CodecTypes`.
  - Emit `export type Contract = SqlContract<Storage, Models, Relations, Mappings>` with:
    - Storage: tables/columns literal types with canonical typeIds and nullability.
    - Models: fields mapped to `CodecTypes[typeId].output` (nullability preserved).
    - Mappings: `modelToTable`, `tableToModel`, `fieldToColumn`, `columnToField`.
  - Optionally export model/row convenience types and ergonomic aliases (`Tables`, `Models`, `Relations`).

### Core Emitter Flow

File: `packages/emitter/src/emitter.ts`

1) Resolve `targetFamily` hook (from `family` export in app config)
2) Use family helpers (from app config) to assemble `operationRegistry`, `codecTypeImports`, `operationTypeImports`, and `extensionIds`
3) Core structural validation (family-agnostic)
4) Family type validation (ensure all type IDs come from referenced extensions)
5) Family structural validation
6) Extensions validation
7) Canonicalize JSON and compute `coreHash`/`profileHash`
8) Generate `contract.json` content (returns string, caller handles I/O)
9) Generate `contract.d.ts` content via `hook.generateContractTypes()` (returns string, caller handles I/O)

**Emitter I/O Decoupling**: The emitter is decoupled from file I/O. The `emit()` function returns `EmitResult` containing:
- `contractJson`: canonical JSON string (caller writes to file)
- `contractDts`: TypeScript definitions string (caller writes to file)
- `coreHash`: computed core hash
- `profileHash`: computed profile hash (optional)

The caller is responsible for all file I/O operations.

### Types-Only Generation Policies

- Import full adapter/pack `CodecTypes` maps for MVP (no Pick optimization); lanes use `LaneCodecTypes` in `schema`/`sql` generics/args to enable `ComputeColumnJsType` inference.
- Do not generate runtime code; `.d.ts` is types-only per ADR 007/114.

### Manifests & Registry

- `packages/emitter/src/extension-pack.ts`: load/validate multiple manifests (adapter + packs).
- `packages/emitter/src/target-family-registry.ts`: resolve hooks by id; default includes SQL.

### Hashing & Profile

- Follow ADR 010 for canonicalization.
- `coreHash` depends on schema meaning; `profileHash` depends on declared capabilities and explicit pins declared in manifests/contract (see Overview and Subsystems refs).

### Testing & TDD

**TDD Requirement**: Each component must be implemented using TDD (Test-Driven Development). Write failing tests first, then implement until green.

- Unit (emitter core): manifest load/validate, type ID validation (ensure all IDs come from extensions), hashing stability, error paths.
- Unit (SQL hook): PK/UK/IDX/FK checks, type validation, type generation emits expected `.d.ts` content.
- Integration: IR → artifacts → lanes (`schema(contract, LaneCodecTypes)` + `sql({ contract, adapter, codecTypes: LaneCodecTypes })`) → plan built/executed; assert SQL/params/meta and `ResultType`.
- **Integration Test (Round-Trip)**: IR → JSON (emit) → IR (parse JSON) → compare with original IR → JSON (emit again) → compare with first emit. Both JSON outputs must be identical (byte-for-byte), proving canonicalization and determinism.
- Parity: TS-only loader path and (later) PSL path must yield identical plans/types.
