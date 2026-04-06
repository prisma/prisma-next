# M6 — SQL emitter migration to shared generation

## Goal

Migrate the SQL emitter hook onto the shared domain-level generation utilities established in M3 (Mongo hook), narrow the `TargetFamilyHook` interface, and move `.d.ts` template ownership into the framework. After this milestone, the framework assembles the full `contract.d.ts` from shared domain-level generators and family-specific storage callbacks. Both SQL and Mongo hooks conform to the same narrowed interface — neither owns a monolithic `generateContractTypes()`.

**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md)
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md) § Milestone 6

## Why single-pass (not two-phase)

The original plan split M6 into 6.1 (refactor SQL hook internals to use shared utilities) and 6.2 (narrow the hook interface), with 6.2 deferred to after M5. M5 is now complete, which makes a single-pass approach simpler:

1. `Contract<TStorage, TModels>` exists at the framework level — both families can reference it in the emitted template.
2. Both families now emit `{ codecId, nullable }` for model fields (M5 task 5.B2 aligned the SQL emitter) — the shared `generateModelFieldsType` works for both.
3. `ContractIR` is gone — `emit()` already accepts `Contract` directly, so there's no intermediate representation complicating the hook signatures.

Doing 6.1 alone (swap duplicated code for shared utility calls) would produce a throwaway intermediate state — the SQL hook would call shared utilities but still own its template, which would be rewritten again during 6.2. One pass eliminates the churn.

## Design decisions

### 1. Framework owns the `.d.ts` template

Today each hook implements `generateContractTypes()` and returns the full `.d.ts` as a string. The SQL hook duplicates every shared utility (serialization, import dedup, hash aliases, roots, relations) inline. The Mongo hook calls shared utilities but still owns its template skeleton.

After M6, the framework's `generateContractDts()` assembles the full template. Hooks provide only family-specific parts via focused callbacks.

### 2. Template structure

The emitted `contract.d.ts` follows a standard structure that the framework controls:

```typescript
// ⚠️  GENERATED FILE - DO NOT EDIT
${componentImports}         // from stack: codec, operation, parameterized type imports
${familyImports}            // from hook: e.g. ContractWithTypeMaps, MongoTypeMaps

import type {
  Contract as ContractType,
  ExecutionHashBase,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';

${hashAliases}              // shared: generateHashTypeAliases

export type CodecTypes = ${codecTypeIntersection};
export type OperationTypes = ${operationTypeIntersection};
${familyTypeAliases}        // from hook: QueryOperationTypes, LaneCodecTypes, DefaultLiteralValue (SQL); empty (Mongo)
export type TypeMaps = ${typeMapsExpression};   // from hook: TypeMapsType<C,O,Q> (SQL) or MongoTypeMaps<C,O> (Mongo)

type Storage = ${storageType};        // from hook: generateStorageType
type Models = ${modelsType};          // framework-orchestrated, calls hook for per-model storage

type ContractBase = ContractType<Storage, Models> & {
  readonly target: ${target};
  readonly roots: ${rootsType};       // shared: generateRootsType
  readonly capabilities: ${capabilities};
  readonly extensionPacks: ${extensionPacks};
  ${executionClause}
  readonly profileHash: ProfileHash;
};

export type Contract = ${contractWrapper};  // from hook: e.g. ContractWithTypeMaps<ContractBase, TypeMaps>
```

The `Models` type is framework-orchestrated: for each model, the framework generates `fields` (shared `generateModelFieldsType`), `relations` (shared `generateModelRelationsType`), and `storage` (hook callback `generateModelStorageType`), plus optional `owner`/`discriminator`/`variants`/`base`.

### 3. Narrowed `TargetFamilyHook` interface

The current interface has three methods: `validateTypes`, `validateStructure`, `generateContractTypes`. After M6:

- `validateTypes` and `validateStructure` — **unchanged**
- `generateContractTypes` — **removed**
- New storage-specific callbacks — **added**

The new callbacks are minimal: each returns a string fragment that the framework inserts into the template. The hook doesn't need to know the template structure.

### 4. `serializeValue` / `serializeObjectKey` are shared utilities

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
| `serializeTypeParamsLiteral` | L450–462 | Kept — only used by `generateStorageType` (can use `serializeValue` directly) |
| `generateStorageType` | L348–422 | Kept — SQL-specific (tables, columns, PKs, FKs, indexes) |
| `generateStorageTypesType` | L428–444 | Kept — SQL-specific (storage.types) |

### Mongo hook functions (to be restructured)

| Function | Lines | Disposition |
| --- | --- | --- |
| `generateContractTypes` | L234–300 | Removed — framework owns template |
| `generateModelFieldsType` | L29–39 | Moved to shared module |
| `generateModelsType` | L62–96 | Removed — use shared `generateModelsType` |
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
   - `storage` via the `generateModelStorage` callback (hook-provided)
   - Optional `owner`, `discriminator`, `variants`, `base` via `serializeValue`
3. Returns the assembled models type literal

The `generateModelStorage` callback is the family-specific part: SQL generates `{ table, fields: { field: { column } } }`, Mongo generates `{ collection, relations? }`.

**Tests:** Unit tests covering models with fields, relations, storage, owner, discriminator, variants, base. Verify both SQL and Mongo emitter tests still pass (this step doesn't change the hooks yet — it adds the shared function).

### Step 3: Define the narrowed `TargetFamilyHook` interface

Update `TargetFamilyHook` in `@prisma-next/framework-components/emission`:

```typescript
export interface TargetFamilyHook {
  readonly id: string;

  validateTypes(contract: Contract, ctx: ValidationContext): void;
  validateStructure(contract: Contract): void;

  /** Top-level storage type definition (e.g. SQL tables, Mongo collections). */
  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  /** Per-model storage type block (e.g. SQL field-to-column mapping, Mongo collection+relations). */
  generateModelStorageType(modelName: string, model: ContractModel): string;

  /** Family-specific import lines for the emitted contract.d.ts. */
  getFamilyImports(): string[];

  /**
   * Family-specific type alias definitions.
   * Inserted after CodecTypes/OperationTypes.
   * SQL: QueryOperationTypes, LaneCodecTypes, DefaultLiteralValue.
   * Mongo: empty string.
   */
  getFamilyTypeAliases(context: FamilyTypeAliasContext): string;

  /**
   * The TypeMaps expression for this family.
   * SQL: "TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>"
   * Mongo: "MongoTypeMaps<CodecTypes, OperationTypes>"
   */
  getTypeMapsExpression(): string;

  /**
   * The contract wrapper expression.
   * Receives the local type name of the contract base and TypeMaps.
   * SQL: "ContractWithTypeMaps<ContractBase, TypeMaps>"
   * Mongo: "MongoContractWithTypeMaps<ContractBase, TypeMaps>"
   */
  getContractWrapper(contractBaseName: string, typeMapsName: string): string;
}

export interface FamilyTypeAliasContext {
  readonly codecTypesName: string;
  readonly operationTypesName: string;
  readonly queryOperationTypesName: string;
}
```

Remove `generateContractTypes` and `GenerateContractTypesOptions` from the interface. The `parameterizedRenderers` and `parameterizedTypeImports` from the old `GenerateContractTypesOptions` move to `generateContractDts`'s input (the framework-owned generator needs them for import assembly).

**Note:** This is a breaking SPI change. Both hooks must be updated in lockstep (Steps 5 and 6).

### Step 4: Add framework-owned `generateContractDts`

Add `generateContractDts()` to `@prisma-next/emitter`. This is the function that replaces `targetFamily.generateContractTypes()`.

```typescript
export function generateContractDts(
  contract: Contract,
  hook: TargetFamilyHook,
  codecTypeImports: ReadonlyArray<TypesImportSpec>,
  operationTypeImports: ReadonlyArray<TypesImportSpec>,
  hashes: { readonly storageHash: string; readonly executionHash?: string; readonly profileHash: string },
  options?: GenerateContractDtsOptions,
): string
```

Where `GenerateContractDtsOptions` carries `parameterizedTypeImports` and `queryOperationTypeImports` (the remaining pieces from the old `GenerateContractTypesOptions` that affect import assembly).

The function assembles the template described in Design Decision §2:

1. Collect all imports (codec + operation + parameterized + query operation), deduplicate via `deduplicateImports`, generate lines via `generateImportLines`
2. Get family-specific imports via `hook.getFamilyImports()`
3. Generate hash aliases via `generateHashTypeAliases`
4. Generate codec/operation type intersections via `generateCodecTypeIntersection`
5. Get family type aliases via `hook.getFamilyTypeAliases(context)`
6. Get TypeMaps expression via `hook.getTypeMapsExpression()`
7. Generate storage type via `hook.generateStorageType(contract, 'StorageHash')`
8. Generate models type via shared `generateModelsType(contract.models, (name, model) => hook.generateModelStorageType(name, model))`
9. Generate roots type via `generateRootsType(contract.roots)`
10. Serialize contract metadata (`target`, `capabilities`, `extensionPacks`, `execution`, `profileHash`) via `serializeValue`
11. Get contract wrapper via `hook.getContractWrapper('ContractBase', 'TypeMaps')`
12. Assemble and return the template string

**Tests:** Unit tests that call `generateContractDts` with mock hooks and verify the template structure. Integration tests that call it with the real SQL and Mongo hooks and verify output matches the current `generateContractTypes` output.

### Step 5: Migrate SQL hook to narrowed interface

Update `sqlTargetFamilyHook` in `packages/2-sql/3-tooling/emitter/src/index.ts`:

**Remove:**
- `generateContractTypes()` — replaced by framework `generateContractDts`
- `generateModelsType()` — replaced by shared `generateModelsType`
- `generateRootsType()` — replaced by shared `generateRootsType`
- `serializeValue()` / `serializeObjectKey()` — replaced by shared imports
- `serializeTypeParamsLiteral()` — inline into `generateStorageType` or replace with `serializeValue` (they're equivalent)
- `IRModelDefinition`, `IRModelField`, `IRModelStorage` local types — use `ContractModel`, `ContractField`, `SqlModelStorage` from the type system

**Keep:**
- `validateTypes(contract, ctx)` — unchanged
- `validateStructure(contract)` — unchanged
- `generateStorageType(contract, storageHashTypeName)` — reworked to use shared `serializeValue`/`serializeObjectKey` instead of `this.serializeValue`/`this.serializeObjectKey`, and to conform to the new signature. Retains SQL-specific table/column/PK/FK/index/storage.types generation.
- `generateStorageTypesType(types)` — kept as a private helper called by `generateStorageType`

**Add:**
- `generateModelStorageType(modelName, model)` — extracted from the old `generateModelsType`. For each model, generates `{ readonly table: '...'; readonly fields: { readonly fieldName: { readonly column: '...' } } }`. Uses shared `serializeValue`/`serializeObjectKey`.
- `getFamilyImports()` — returns the SQL-specific import lines:
  ```typescript
  ["import type { ContractWithTypeMaps, TypeMaps as TypeMapsType } from '@prisma-next/sql-contract/types';"]
  ```
- `getFamilyTypeAliases(context)` — returns SQL-specific type aliases: `LaneCodecTypes`, `QueryOperationTypes`, `DefaultLiteralValue`.
- `getTypeMapsExpression()` — returns `"TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>"`
- `getContractWrapper(base, typeMaps)` — returns `` `ContractWithTypeMaps<${base}, ${typeMaps}>` ``

**Tests:** Update all SQL emitter tests. Verify `contract.d.ts` output is identical to current output for all test contracts (demo + parity fixtures). Test the new hook methods individually.

### Step 6: Migrate Mongo hook to narrowed interface

Update `mongoTargetFamilyHook` in `packages/2-mongo-family/3-tooling/emitter/src/index.ts`:

**Remove:**
- `generateContractTypes()` — replaced by framework `generateContractDts`
- Local `generateModelsType()` — replaced by shared `generateModelsType`
- Local `generateModelFieldsType()` — now imported from shared module (Step 1)

**Keep:**
- `validateTypes(contract, ctx)` — unchanged
- `validateStructure(contract)` — unchanged
- `generateStorageType(contract, storageHashTypeName)` — reworked to conform to new signature. Retains Mongo-specific collection generation.
- `generateModelStorageType(modelName, model)` — already exists as a local function, promote to hook method. Generates `{ readonly collection: '...'; readonly relations?: { ... } }`.

**Add:**
- `getFamilyImports()` — returns the Mongo-specific import lines:
  ```typescript
  ["import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@prisma-next/mongo-contract';"]
  ```
- `getFamilyTypeAliases(context)` — returns empty string (Mongo has no family-specific type aliases beyond CodecTypes/OperationTypes)
- `getTypeMapsExpression()` — returns `"MongoTypeMaps<CodecTypes, OperationTypes>"`
- `getContractWrapper(base, typeMaps)` — returns `` `MongoContractWithTypeMaps<${base}, ${typeMaps}>` ``

**Tests:** Update all Mongo emitter tests. Verify `contract.d.ts` output is identical to current output.

### Step 7: Update `emit()` pipeline

Update `emit()` in `packages/1-framework/3-tooling/emitter/src/emit.ts`:

**Before:**
```typescript
const contractDtsRaw = targetFamily.generateContractTypes(
  contract, codecTypeImports ?? [], operationTypeImports ?? [],
  contractTypeHashes, generateOptions,
);
```

**After:**
```typescript
const contractDtsRaw = generateContractDts(
  contract, targetFamily, codecTypeImports ?? [], operationTypeImports ?? [],
  contractTypeHashes, generateOptions,
);
```

The `GenerateContractTypesOptions` type is replaced by `GenerateContractDtsOptions` which carries only the import-assembly options (`parameterizedTypeImports`, `queryOperationTypeImports`). The `parameterizedRenderers` field is no longer needed at this level (it was only used by the SQL hook's old `generateColumnType`, which no longer exists post-M5).

**Tests:** Existing `emit()` tests verify the full pipeline. No new tests needed — the change is a delegation point.

### Step 8: Cleanup

- Remove `GenerateContractTypesOptions` from `@prisma-next/framework-components/emission` (replaced by `GenerateContractDtsOptions` or inlined)
- Remove any remaining `generateContractTypes` references across the codebase
- Verify no consumer constructs a `TargetFamilyHook` with the old `generateContractTypes` method

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
| `TargetFamilyHook` interface | `packages/1-framework/1-core/framework-components/src/emission-types.ts` |
| SQL emitter hook | `packages/2-sql/3-tooling/emitter/src/index.ts` |
| Mongo emitter hook | `packages/2-mongo-family/3-tooling/emitter/src/index.ts` |
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
