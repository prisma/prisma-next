# M6 — SQL emitter migration to shared generation

## Goal

Migrate the SQL emitter onto the shared domain-level generation utilities established in M3 (Mongo), move `.d.ts` template ownership into the framework, and replace the monolithic `TargetFamilyHook` with a focused `EmissionSpi` interface on the family descriptor. After this milestone, the framework assembles the full `contract.d.ts` from shared domain-level generators and family-specific storage callbacks. Both SQL and Mongo families implement `EmissionSpi` — neither owns a monolithic `generateContractTypes()`.

**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md)
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md) § Milestone 6

## Design decisions

### 1. `TargetFamilyHook` → `EmissionSpi`

`TargetFamilyHook` is a vague name that bundles unrelated concerns (validation, type generation) behind a "hook" abstraction. Replace it with `EmissionSpi` — a focused interface for the family-specific parts of contract type emission.

The `ControlFamilyDescriptor` currently holds `readonly hook: TargetFamilyHook`. After M6, this becomes `readonly emission: EmissionSpi`. The descriptor is the composition point; the SPI is the focused interface. This is extensible — when the next control operation needs family customization, it gets its own SPI, and the descriptor gains a new field:

```typescript
descriptor.emission.generateContractTypes(...)  // emission SPI
descriptor.migration.plan(...)                  // future: migration SPI
```

### 2. Validation removed from the emission SPI

The current hook carries `validateTypes()` and `validateStructure()`. These don't belong on the emission interface:

- `emit()` receives a typed `Contract` built by the authoring surface. If the authoring surface produced an invalid contract, that's a bug to fix at the source.
- The framework already has `validateContract()` for parsing untrusted JSON with three-pass validation (structural, domain, storage).
- The emission pipeline shouldn't be doing defensive validation on trusted input.

The validation methods are dropped from `EmissionSpi`. If there's value in a standalone "is this contract well-formed?" function for debugging, it can exist independently.

### 3. Framework owns the `.d.ts` template

Today each hook implements `generateContractTypes()` and returns the full `.d.ts` as a string. The SQL hook duplicates every shared utility (serialization, import dedup, hash aliases, roots, relations) inline. The Mongo hook calls shared utilities but still owns its template skeleton.

After M6, the framework's `generateContractDts()` assembles the full template. The `EmissionSpi` provides only family-specific parts via focused callbacks.

### 4. Template structure

The emitted `contract.d.ts` follows a standard structure that the framework controls:

```typescript
// ⚠️  GENERATED FILE - DO NOT EDIT
${componentImports}         // from stack: codec, operation, parameterized type imports
${familyImports}            // from EmissionSpi

import type {
  Contract as ContractType,
  ExecutionHashBase,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';

${hashAliases}              // shared: generateHashTypeAliases

export type CodecTypes = ${codecTypeIntersection};
export type OperationTypes = ${operationTypeIntersection};
${familyTypeAliases}        // from EmissionSpi (SQL: QueryOperationTypes, LaneCodecTypes, DefaultLiteralValue; Mongo: empty)
export type TypeMaps = ${typeMapsExpression};   // from EmissionSpi

type Storage = ${storageType};        // from EmissionSpi: generateStorageType
type Models = ${modelsType};          // framework-orchestrated, calls EmissionSpi for per-model storage

type ContractBase = ContractType<Storage, Models> & {
  readonly target: ${target};
  readonly roots: ${rootsType};       // shared: generateRootsType
  readonly capabilities: ${capabilities};
  readonly extensionPacks: ${extensionPacks};
  ${executionClause}
  readonly profileHash: ProfileHash;
};

export type Contract = ${contractWrapper};  // from EmissionSpi
```

The `Models` type is framework-orchestrated: for each model, the framework generates `fields` (shared `generateModelFieldsType`), `relations` (shared `generateModelRelationsType`), and `storage` (EmissionSpi callback `generateModelStorageType`), plus optional `owner`/`discriminator`/`variants`/`base`.

### 5. `serializeValue` / `serializeObjectKey` are shared utilities

These already exist in `@prisma-next/emitter/domain-type-generation` (extracted during M3). The SQL hook's identical copies (as `this.serializeValue` / `this.serializeObjectKey` on the object literal) are removed. All callers use the shared freestanding functions.

## Current state (pre-M6)

### Shared utilities (`@prisma-next/emitter/domain-type-generation`)

| Function | Used by Mongo | Used by SQL |
| --- | --- | --- |
| `serializeValue` | ✅ | ❌ (duplicate on hook) |
| `serializeObjectKey` | ✅ | ❌ (duplicate on hook) |
| `generateRootsType` | ✅ | ❌ (duplicate on hook) |
| `generateModelRelationsType` | ✅ | ❌ (inline in `generateModelsType`) |
| `deduplicateImports` | ✅ | ❌ (inline in `generateContractTypes`) |
| `generateImportLines` | ✅ | ❌ (inline in `generateContractTypes`) |
| `generateCodecTypeIntersection` | ✅ | ❌ (inline in `generateContractTypes`) |
| `generateHashTypeAliases` | ✅ | ❌ (inline in `generateContractTypes`) |

### SQL hook methods (to be removed or restructured)

| Method | Lines | Disposition |
| --- | --- | --- |
| `generateContractTypes` | L207–333 | Removed — framework owns template |
| `generateRootsType` | L336–346 | Removed — use shared `generateRootsType` |
| `generateModelsType` | L506–597 | Removed — use shared `generateModelsType` |
| `serializeValue` | L467–497 | Removed — use shared `serializeValue` |
| `serializeObjectKey` | L499–504 | Removed — use shared `serializeObjectKey` |
| `serializeTypeParamsLiteral` | L450–462 | Removed — use `serializeValue` directly |
| `validateTypes` | L26–53 | Removed from emission SPI |
| `validateStructure` | L55–205 | Removed from emission SPI |
| `generateStorageType` | L348–422 | Kept — SQL-specific (tables, columns, PKs, FKs, indexes) |
| `generateStorageTypesType` | L428–444 | Kept — SQL-specific (storage.types), private helper |

### Mongo hook functions (to be restructured)

| Function | Lines | Disposition |
| --- | --- | --- |
| `generateContractTypes` | L234–300 | Removed — framework owns template |
| `generateModelFieldsType` | L29–39 | Moved to shared module |
| `generateModelsType` | L62–96 | Removed — use shared `generateModelsType` |
| `validateTypes` | L118–138 | Removed from emission SPI |
| `validateStructure` | L140–232 | Removed from emission SPI |
| `generateStorageType` | L98–113 | Kept — Mongo-specific (collections) |
| `generateModelStorageType` | L41–60 | Kept — Mongo-specific (collection, storage.relations) |

## Steps

### Step 1: Extract `generateModelFieldsType` to shared module

Move `generateModelFieldsType()` from the Mongo hook (`packages/2-mongo-family/3-tooling/emitter/src/index.ts` L29–39) to `@prisma-next/emitter/domain-type-generation`.

The function generates `{ readonly codecId: '...'; readonly nullable: true/false }` per field. Both SQL and Mongo now produce this same shape (M5 aligned SQL's model fields to `ContractField` format).

```typescript
export function generateModelFieldsType(
  fields: Record<string, { readonly codecId: string; readonly nullable: boolean }>,
): string
```

Export from `@prisma-next/emitter/domain-type-generation`. Update the Mongo hook to import from the shared module.

**Tests:** Unit test in the domain-type-generation test file. Verify Mongo emitter tests still pass.

### Step 2: Add shared `generateModelsType`

Add `generateModelsType()` to the shared module. This replaces the duplicated `generateModelsType()` in both hooks.

```typescript
export function generateModelsType(
  models: Record<string, ContractModel>,
  generateModelStorage: (modelName: string, model: ContractModel) => string,
): string
```

The function:
1. Iterates models sorted by name (matching current SQL behavior)
2. For each model, generates:
   - `fields` via `generateModelFieldsType(model.fields)`
   - `relations` via `generateModelRelationsType(model.relations)`
   - `storage` via the `generateModelStorage` callback (family-provided)
   - Optional `owner`, `discriminator`, `variants`, `base` via `serializeValue`
3. Returns the assembled models type literal

The `generateModelStorage` callback is the family-specific part: SQL generates `{ table, fields: { field: { column } } }`, Mongo generates `{ collection, relations? }`.

**Tests:** Unit tests covering models with fields, relations, storage, owner, discriminator, variants, base. Verify both SQL and Mongo emitter tests still pass (this step doesn't change the hooks yet — it adds the shared function).

### Step 3: Define `EmissionSpi` and update `ControlFamilyDescriptor`

Replace `TargetFamilyHook` with `EmissionSpi` in `@prisma-next/framework-components/emission`:

```typescript
export interface EmissionSpi {
  generateContractTypes(
    contract: Contract,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
    hashes: {
      readonly storageHash: string;
      readonly executionHash?: string;
      readonly profileHash: string;
    },
    options?: GenerateContractTypesOptions,
  ): string;
}
```

This is the current `generateContractTypes` signature, unchanged — we're extracting the SPI, not restructuring it yet. The method surface will narrow in later steps (4–7) when the framework takes over template ownership.

Update `ControlFamilyDescriptor` in `control-descriptors.ts`:

```typescript
export interface ControlFamilyDescriptor<TFamilyId, TFamilyInstance>
  extends FamilyDescriptor<TFamilyId> {
  readonly emission: EmissionSpi;
  create<TTargetId extends string>(stack: ControlStack<TFamilyId, TTargetId>): TFamilyInstance;
}
```

Remove `TargetFamilyHook` interface. Remove `GenerateContractTypesOptions` and `ValidationContext` from `emission-types.ts` if they're only used by the old hook — or keep them temporarily until Step 8 cleans up.

Update `emit()` to accept `EmissionSpi` instead of `TargetFamilyHook`:

```typescript
export async function emit(
  contract: Contract,
  stack: EmitStackInput,
  emitter: EmissionSpi,
): Promise<EmitResult>
```

Update `SqlFamilyDescriptor` to use `readonly emission = sqlContractTypeEmitter` instead of `readonly hook = sqlTargetFamilyHook`. Rename `sqlTargetFamilyHook` → `sqlEmission` (or `sqlContractTypeEmitter`). Same for Mongo.

Update all call sites that pass `family.hook` to `emit()` — pass `family.emission` instead.

**Tests:** All existing tests pass with the rename. No behavioral change.

### Step 4: Add framework-owned `generateContractDts`

Add `generateContractDts()` to `@prisma-next/emitter`. This function assembles the full `.d.ts` template from shared and family-specific parts.

```typescript
export function generateContractDts(
  contract: Contract,
  emitter: EmissionSpi,
  codecTypeImports: ReadonlyArray<TypesImportSpec>,
  operationTypeImports: ReadonlyArray<TypesImportSpec>,
  hashes: { readonly storageHash: string; readonly executionHash?: string; readonly profileHash: string },
  options?: GenerateContractDtsOptions,
): string
```

For now, this function simply delegates to `emitter.generateContractTypes(...)` — it's a pass-through that establishes the call site. Steps 5–7 will move logic from the emitters into this function.

**Tests:** Integration tests that call `generateContractDts` with the real SQL and Mongo emitters and verify output matches the current output.

### Step 5: Narrow `EmissionSpi` — framework takes over template

Replace the monolithic `generateContractTypes` on `EmissionSpi` with focused callbacks:

```typescript
export interface EmissionSpi {
  generateStorageType(contract: Contract, storageHashTypeName: string): string;
  generateModelStorageType(modelName: string, model: ContractModel): string;
  getFamilyImports(): string[];
  getFamilyTypeAliases(context: FamilyTypeAliasContext): string;
  getTypeMapsExpression(): string;
  getContractWrapper(contractBaseName: string, typeMapsName: string): string;
}
```

Move template assembly logic into `generateContractDts()`:

1. Collect all imports, deduplicate via `deduplicateImports`, generate lines via `generateImportLines`
2. Get family-specific imports via `emitter.getFamilyImports()`
3. Generate hash aliases via `generateHashTypeAliases`
4. Generate codec/operation type intersections via `generateCodecTypeIntersection`
5. Get family type aliases via `emitter.getFamilyTypeAliases(context)`
6. Get TypeMaps expression via `emitter.getTypeMapsExpression()`
7. Generate storage type via `emitter.generateStorageType(contract, 'StorageHash')`
8. Generate models type via shared `generateModelsType(contract.models, (name, model) => emitter.generateModelStorageType(name, model))`
9. Generate roots type via `generateRootsType(contract.roots)`
10. Serialize contract metadata (`target`, `capabilities`, `extensionPacks`, `execution`, `profileHash`) via `serializeValue`
11. Get contract wrapper via `emitter.getContractWrapper('ContractBase', 'TypeMaps')`
12. Assemble and return the template string

**Tests:** Verify emitted `contract.d.ts` output is identical (modulo formatting) before and after, for all test contracts.

### Step 6: Migrate SQL emitter to narrowed `EmissionSpi`

Update `sqlContractTypeEmitter` (previously `sqlTargetFamilyHook`) in `packages/2-sql/3-tooling/emitter/src/index.ts`:

**Remove:**
- `generateContractTypes()` — replaced by framework `generateContractDts`
- `generateModelsType()` — replaced by shared `generateModelsType`
- `generateRootsType()` — replaced by shared `generateRootsType`
- `serializeValue()` / `serializeObjectKey()` — replaced by shared imports
- `serializeTypeParamsLiteral()` — use `serializeValue` directly
- `validateTypes()` / `validateStructure()` — not part of `EmissionSpi`
- `IRModelDefinition`, `IRModelField`, `IRModelStorage` local types — use `ContractModel`, `ContractField`, `SqlModelStorage`

**Keep:**
- `generateStorageType(contract, storageHashTypeName)` — reworked to use shared `serializeValue`/`serializeObjectKey`. Retains SQL-specific table/column/PK/FK/index/storage.types generation.
- `generateStorageTypesType(types)` — kept as a private helper called by `generateStorageType`

**Add:**
- `generateModelStorageType(modelName, model)` — extracted from the old `generateModelsType`. Generates `{ readonly table: '...'; readonly fields: { readonly fieldName: { readonly column: '...' } } }`.
- `getFamilyImports()` — returns SQL-specific import lines
- `getFamilyTypeAliases(context)` — returns SQL-specific type aliases (`LaneCodecTypes`, `QueryOperationTypes`, `DefaultLiteralValue`)
- `getTypeMapsExpression()` — returns `"TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>"`
- `getContractWrapper(base, typeMaps)` — returns `` `ContractWithTypeMaps<${base}, ${typeMaps}>` ``

**Tests:** Update SQL emitter tests. Verify `contract.d.ts` output is identical for all test contracts (demo + parity fixtures). Test the new methods individually.

### Step 7: Migrate Mongo emitter to narrowed `EmissionSpi`

Update `mongoEmission` (previously `mongoTargetFamilyHook`) in `packages/2-mongo-family/3-tooling/emitter/src/index.ts`:

**Remove:**
- `generateContractTypes()` — replaced by framework `generateContractDts`
- Local `generateModelsType()` — replaced by shared `generateModelsType`
- Local `generateModelFieldsType()` — now imported from shared module (Step 1)
- `validateTypes()` / `validateStructure()` — not part of `EmissionSpi`

**Keep:**
- `generateStorageType(contract, storageHashTypeName)` — Mongo-specific collection generation
- `generateModelStorageType(modelName, model)` — Mongo-specific (collection + storage.relations)

**Add:**
- `getFamilyImports()` — returns Mongo-specific import lines
- `getFamilyTypeAliases(context)` — returns empty string
- `getTypeMapsExpression()` — returns `"MongoTypeMaps<CodecTypes, OperationTypes>"`
- `getContractWrapper(base, typeMaps)` — returns `` `MongoContractWithTypeMaps<${base}, ${typeMaps}>` ``

**Tests:** Update Mongo emitter tests. Verify `contract.d.ts` output is identical.

### Step 8: Update `emit()` pipeline

Update `emit()` in `packages/1-framework/3-tooling/emitter/src/emit.ts` to call `generateContractDts()` instead of `emitter.generateContractTypes()`. At this point `generateContractDts` is no longer a pass-through (Step 4) — it owns the template (Step 5).

Remove `GenerateContractTypesOptions` from `@prisma-next/framework-components/emission`. Remove `ValidationContext` if no other consumer needs it (check usages). Clean up any remaining references to `TargetFamilyHook`, `generateContractTypes`, or `hook` across the codebase.

### Step 9: Verification

- `pnpm test:packages` — all package tests pass
- `pnpm test:integration` — integration tests pass
- `pnpm test:e2e` — e2e tests pass
- `pnpm typecheck` — no type errors
- `pnpm lint:deps` — no layering violations
- Verify emitted `contract.d.ts` output is identical (modulo formatting) for the SQL demo contract and all authoring parity fixtures
- Verify emitted `contract.d.ts` output is identical for the Mongo demo contract

## Reference files

| Area | Path |
| --- | --- |
| Shared domain-type generation | `packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts` |
| `emit()` | `packages/1-framework/3-tooling/emitter/src/emit.ts` |
| `TargetFamilyHook` (to be replaced) | `packages/1-framework/1-core/framework-components/src/emission-types.ts` |
| `ControlFamilyDescriptor` | `packages/1-framework/1-core/framework-components/src/control-descriptors.ts` |
| `SqlFamilyDescriptor` | `packages/2-sql/9-family/src/core/control-descriptor.ts` |
| SQL emitter | `packages/2-sql/3-tooling/emitter/src/index.ts` |
| Mongo emitter | `packages/2-mongo-family/3-tooling/emitter/src/index.ts` |
| `Contract<TStorage, TModels>` | `packages/1-framework/0-foundation/contract/src/contract-types.ts` |
| `ContractModel<TModelStorage>` | `packages/1-framework/0-foundation/contract/src/domain-types.ts` |
| `ContractField` | `packages/1-framework/0-foundation/contract/src/domain-types.ts` |
| `SqlStorage`, `SqlModelStorage` | `packages/2-sql/1-core/contract/src/types.ts` |
| `ContractWithTypeMaps` | `packages/2-sql/1-core/contract/src/types.ts` |
| `MongoStorage`, `MongoModelStorage` | `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts` |
| `MongoContractWithTypeMaps` | `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts` |
| SQL demo contract | `examples/prisma-next-demo/src/prisma/contract.d.ts` |
| Authoring parity fixtures | `test/integration/test/authoring/parity/` |
| Mongo demo contract | `examples/mongo-demo/src/prisma/contract.d.ts` |
| SQL emitter tests | `packages/2-sql/3-tooling/emitter/test/` |
| Mongo emitter tests | `packages/2-mongo-family/3-tooling/emitter/test/` |

## Dependencies

- **M5 complete** — `Contract<TStorage, TModels>`, `ContractModel<TModelStorage>`, `ContractField` all exist. `ContractIR` removed. `emit()` accepts `Contract`. Both families emit `{ codecId, nullable }` model fields.
- **M3 complete** — shared utilities exist in `@prisma-next/emitter/domain-type-generation`. Mongo hook is the reference implementation.
- **No dependency on task 3.11** (Mongo PSL interpreter) or close-out tasks.
