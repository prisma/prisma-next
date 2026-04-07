# Codec-Dispatched Type Rendering — Execution Plan

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)
**Spec:** [codec-dispatched-type-rendering.md](../specs/codec-dispatched-type-rendering.md)
**ADR:** [ADR 186](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)

## Collaborators

| Role  | Person | Context |
| ----- | ------ | ------- |
| Maker | Will   | Drives execution |

## Prerequisites

- **TML-2206** (value objects & embedded documents) must land first.
- **TML-2215** (parameterized renderers bug fix) has landed.

## Strategy

Each milestone is additive — the next builds on top without breaking existing tests — until the final milestone which deletes the legacy infrastructure. This means during milestones 1–4, both old and new systems coexist.

---

## Milestone 1: Add `renderOutputType` to the Codec interface and implement on codecs

Additive. No existing code changes behavior. Tests verify the new method in isolation.

### 1.1 Add `renderOutputType` to framework `Codec` base

**File:** `packages/1-framework/1-core/framework-components/src/codec-types.ts`

Add the optional method to the `Codec` interface:

```typescript
renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
```

No factory changes needed — the method is optional.

### 1.2 Implement `renderOutputType` on Postgres codecs

**File:** `packages/3-targets/6-adapters/postgres/src/core/codecs.ts`

Move rendering logic from `descriptor-meta.ts` parameterized renderers onto the codec objects:

- **`pg/json@1`, `pg/jsonb@1`:** Calls `renderTypeScriptTypeFromJsonSchema(schemaJson)` when `typeParams.schemaJson` is present, returns `typeParams.type` when present, otherwise `undefined`. Imports `renderTypeScriptTypeFromJsonSchema` from `json-schema-type-expression.ts` (stays in `adapter-postgres`).
- **`pg/enum@1`:** Renders literal union from `typeParams.values`.
- **`sql/char@1`, `pg/char@1`:** Returns `Char<${length}>`.
- **`sql/varchar@1`, `pg/varchar@1`:** Returns `Varchar<${length}>`.
- **`pg/numeric@1`:** Returns `Numeric<P>` or `Numeric<P, S>`.
- **`pg/bit@1`:** Returns `Bit<${length}>`.
- **`pg/varbit@1`:** Returns `VarBit<${length}>`.
- **`sql/timestamp@1`, `pg/timestamp@1`:** Returns `Timestamp<P>`.
- **`pg/timestamptz@1`:** Returns `Timestamptz<P>`.
- **`pg/time@1`:** Returns `Time<P>`.
- **`pg/timetz@1`:** Returns `Timetz<P>`.
- **`pg/interval@1`:** Returns `Interval<P>`.

### 1.3 Implement `renderOutputType` on pgvector codec

**File:** `packages/3-extensions/pgvector/src/core/codecs.ts`

- **`pg/vector@1`:** Returns `Vector<${length}>`.

### 1.4 Add `isSafeTypeExpression` as a shared utility

**File:** `packages/1-framework/3-tooling/emitter/src/type-expression-safety.ts` (new file)

Move the `isSafeTypeExpression` check from `descriptor-meta.ts` to a reusable location. The emitter will call this on the string returned by `renderOutputType` before emitting it.

### 1.5 Tests

**New test file:** `packages/3-targets/6-adapters/postgres/test/codec-render-output-type.test.ts`

- `pg/jsonb@1` with `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }` → `'{ name: string }'`
- `pg/jsonb@1` with `{ type: 'AuditPayload' }` → `'AuditPayload'`
- `pg/jsonb@1` with `{}` → `undefined`
- `pg/enum@1` with `{ values: ['USER', 'ADMIN'] }` → `"'USER' | 'ADMIN'"`
- `pg/enum@1` with `{}` → `undefined`
- `sql/char@1` with `{ length: 36 }` → `'Char<36>'`
- `pg/numeric@1` with `{ precision: 10, scale: 2 }` → `'Numeric<10, 2>'`
- `pg/numeric@1` with `{ precision: 10 }` → `'Numeric<10>'`
- `pg/timestamptz@1` with `{ precision: 3 }` → `'Timestamptz<3>'`
- `pg/int4@1` has no `renderOutputType` → `codec.renderOutputType` is `undefined`
- Safety: `renderOutputType` returning `import(...)` → rejected by `isSafeTypeExpression`

**New test file:** `packages/3-extensions/pgvector/test/codec-render-output-type.test.ts`

- `pg/vector@1` with `{ length: 1536 }` → `'Vector<1536>'`
- `pg/vector@1` with `{}` → `undefined`

### Packages touched

| Package | Change |
|---------|--------|
| `@prisma-next/framework-components` | Add `renderOutputType` to `Codec` interface |
| `@prisma-next/adapter-postgres` | Implement `renderOutputType` on 14 codecs |
| `@prisma-next/extension-pgvector` | Implement `renderOutputType` on 1 codec |
| `@prisma-next/emitter` | Add `isSafeTypeExpression` utility |

---

## Milestone 2: Emit `FieldOutputTypes` map

The framework emitter generates the `FieldOutputTypes` map. The map is emitted as a new export in `contract.d.ts`. The SQL emitter's override is still present but no longer the sole mechanism.

### 2.1 Add `CodecLookup` to `EmitStackInput`

**File:** `packages/1-framework/3-tooling/emitter/src/emit-types.ts`

```typescript
export interface EmitStackInput {
  // ... existing fields ...
  readonly codecLookup?: CodecLookup;
}
```

### 2.2 Assemble `CodecLookup` in the control stack

**File:** `packages/1-framework/1-core/framework-components/src/control-stack.ts`

Add a new extraction function that collects codec instances from adapter and extension descriptors. This requires a new contribution point on `ComponentMetadata` — descriptors expose their codecs (e.g., `types.codecTypes.codecInstances: Codec[]`).

Add `codecLookup` to the `ControlStack` interface and wire it in `createControlStack`.

### 2.3 Extend `generateFieldResolvedType` with codec dispatch

**File:** `packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts`

TML-2206 introduced `generateFieldResolvedType(field: ContractField): string`, which already handles all three field kinds:
- Scalar → `CodecTypes[codecId]['output']`
- ValueObject → name reference
- Union → members joined with `|`
- Plus `many`, `dict`, `nullable` modifiers

Extend this function to accept an optional `CodecLookup`. For scalar fields with `typeParams`, when a `CodecLookup` is provided:

1. Look up the codec via `codecLookup.get(field.type.codecId)`
2. If the codec has `renderOutputType`, call it with `field.type.typeParams`
3. If it returns a string, validate via `isSafeTypeExpression`, then use it as the output type
4. Otherwise fall back to `CodecTypes[codecId]['output']` (existing behavior)

Value object and union fields pass through unchanged.

Add a new function `generateFieldOutputTypesMap` that iterates models and their fields, calls the extended `generateFieldResolvedType` for each, and returns the full map type expression.

### 2.4 Emit the map in `generateContractDts`

**File:** `packages/1-framework/3-tooling/emitter/src/generate-contract-dts.ts`

1. Call `generateFieldOutputTypesMap` with models, `CodecLookup`, and codec type imports
2. Emit `export type FieldOutputTypes = { ... };` after `TypeMaps`
3. Wire `FieldOutputTypes` into `TypeMaps` (add as fourth type parameter)

### 2.5 Add `FieldOutputTypes` to `TypeMaps`

**File:** `packages/2-sql/1-core/contract/src/types.ts`

Extend the `TypeMaps` type with a fourth type parameter:

```typescript
export type TypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  TOperationTypes extends Record<string, unknown> = Record<string, never>,
  TQueryOperationTypes extends Record<string, unknown> = Record<string, never>,
  TFieldOutputTypes extends Record<string, Record<string, unknown>> = Record<string, never>,
> = {
  readonly codecTypes: TCodecTypes;
  readonly operationTypes: TOperationTypes;
  readonly queryOperationTypes: TQueryOperationTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
};
```

Add `ExtractFieldOutputTypes<T>` helper alongside the existing extractors.

Update `EmissionSpi.getTypeMapsExpression()` in the SQL emitter to include the fourth parameter.

### 2.6 Thread `CodecLookup` through `emit()`

**File:** `packages/1-framework/3-tooling/emitter/src/emit.ts`

Extract `codecLookup` from `stack` and pass it to `generateContractDts`.

### 2.7 Tests

**Update:** `packages/2-sql/3-tooling/emitter/test/emitter-hook.parameterized-types.test.ts`

Add new tests that verify the emitted `FieldOutputTypes` map:

- Contract with `pg/int4@1` field → `FieldOutputTypes` entry is `CodecTypes['pg/int4@1']['output']`
- Contract with `pg/vector@1` field, `typeParams: { length: 1536 }` → `FieldOutputTypes` entry is `Vector<1536>`
- Contract with `pg/jsonb@1` field, JSON schema `typeParams` → `FieldOutputTypes` entry is the rendered schema type
- Contract with `pg/enum@1` field, `typeParams: { values: ['A', 'B'] }` → `FieldOutputTypes` entry is `'A' | 'B'`
- Nullable field → `FieldOutputTypes` entry includes `| null`
- Multiple models → all appear in the map

**Update:** `packages/2-sql/9-family/test/emit-parameterized.test.ts`

Add E2E tests that emit a contract and verify the `FieldOutputTypes` export exists alongside the structural model fields.

### Packages touched

| Package | Change |
|---------|--------|
| `@prisma-next/framework-components` | `ComponentMetadata` codec contribution, `ControlStack.codecLookup` |
| `@prisma-next/emitter` | `EmitStackInput.codecLookup`, `generateFieldOutputTypesMap`, emit the map |
| `@prisma-next/sql-contract` | `TypeMaps` fourth parameter, `ExtractFieldOutputTypes` |
| `@prisma-next/sql-contract-emitter` | Update `getTypeMapsExpression()` |

---

## Milestone 3: Wire consumers to `FieldOutputTypes`

`ComputeColumnJsType` reads from `FieldOutputTypes` instead of dispatching through `CodecTypes`. `ContractModelBase.fields` is tightened.

### 3.1 Simplify `ComputeColumnJsType`

**File:** `packages/2-sql/4-lanes/relational-core/src/types.ts`

Today, `ComputeColumnJsType` first tries `ExtractColumnJsTypeFromModels` → `ResolveModelFieldToJsType` (which branches on `field.type.kind`: scalar → `CodecTypes[codecId]['output']`, valueObject → `ResolveValueObjectJsType`, union → `unknown`), then falls back to storage column resolution with `ExtractParameterizedCodecOutputType`.

Replace the entire chain with a map lookup:

```typescript
export type ComputeColumnJsType<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
  _ColumnMeta extends StorageColumn,
  _CodecTypes extends Record<string, { readonly output: unknown }>,
> = ExtractFieldOutputTypeForColumn<TContract, TableName, ColumnName>;
```

Where `ExtractFieldOutputTypeForColumn` resolves `Table → Model → Field` and reads from `FieldOutputTypes[ModelName][FieldName]`. Since `FieldOutputTypes` already contains resolved types for all field kinds with `many`/`dict`/`nullable` modifiers applied, the entire `ResolveModelFieldToJsType` chain is redundant.

Delete: `ExtractParameterizedCodecOutputType`, `ResolveColumnTypeParams`, `ResolveModelFieldToJsType`, `ResolveValueObjectJsType` (these are all replaced by the map lookup).

### 3.2 Tighten `ContractModelBase.fields`

**File:** `packages/1-framework/0-foundation/contract/src/domain-types.ts`

Change:
```typescript
readonly fields: Readonly<Record<string, unknown>>;
```
To:
```typescript
readonly fields: Record<string, ContractField>;
```

Remove the doc comment about "rendered types produced by parameterized renderers."

### 3.3 Tests

- Existing `compute-column-js-type.test-d.ts` updated to use `FieldOutputTypes` in the fixture contracts
- All existing query lane type tests pass
- `pnpm typecheck` across the repo

### Packages touched

| Package | Change |
|---------|--------|
| `@prisma-next/sql-relational-core` | Simplify `ComputeColumnJsType`, delete helper types |
| `@prisma-next/contract` | Tighten `ContractModelBase.fields` |

---

## Milestone 4: No-emit path produces `FieldOutputTypes`

The programmatic contract builder produces `FieldOutputTypes` so the no-emit path has the same type resolution as the emit path.

### 4.1 Compute `FieldOutputTypes` in `staged-contract-types.ts`

**File:** `packages/2-sql/2-authoring/contract-ts/src/staged-contract-types.ts`

Add a type-level computation that collects each column's output type from the staged definition into a `FieldOutputTypes` map. For non-parameterized codecs, this is `CodecTypes[codecId]['output']`. For parameterized codecs (vector, char, etc.), the column descriptor already carries the branded output type at the type level.

Wire the computed `FieldOutputTypes` into the `SqlContractResult` type as the fourth `TypeMaps` parameter.

### 4.2 Remove phantom `schema` key from JSON column types

**File:** `packages/3-targets/6-adapters/postgres/src/exports/column-types.ts`

- Remove the phantom `schema: TSchema` key from `TypedColumnDescriptor`
- Simplify `createJsonColumnFactory` — return type no longer includes phantom
- JSON Schema columns in the no-emit path will resolve to `JsonValue` (the codec's default output type)

### 4.3 Tests

- No-emit `vector(1536)` column → `FieldOutputTypes` has `Vector<1536>`
- No-emit `text()` column → `FieldOutputTypes` has `string`
- No-emit `jsonb(schema)` column → `FieldOutputTypes` has `JsonValue` (not a regression — was `unknown`)
- No-emit `jsonb()` column → `FieldOutputTypes` has `JsonValue`
- Existing contract builder tests pass

### Packages touched

| Package | Change |
|---------|--------|
| `@prisma-next/sql-contract-ts` | Compute `FieldOutputTypes` in `staged-contract-types.ts` |
| `@prisma-next/adapter-postgres` | Remove phantom `schema` key from `column-types.ts` |

---

## Milestone 5: Delete legacy infrastructure

Remove all code that is now redundant. This is the largest single diff but all behavioral changes have already been validated by milestones 1–4.

### 5.1 Delete `EmissionSpi.generateModelsType?` and SQL override

**Files:**
- `packages/1-framework/1-core/framework-components/src/emission-types.ts` — remove `generateModelsType?` from `EmissionSpi`
- `packages/2-sql/3-tooling/emitter/src/index.ts` — delete the ~110-line `generateModelsType` override
- `packages/1-framework/3-tooling/emitter/src/generate-contract-dts.ts` — remove the `emitter.generateModelsType ? ... :` branch; always use framework `generateModelsType`

### 5.2 Delete `parameterizedRenderers` infrastructure

**Files:**

| File | Delete |
|------|--------|
| `framework-components/src/type-renderers.ts` | Entire file |
| `framework-components/src/emission-types.ts` | `TypeRenderEntry`, `ParameterizedCodecDescriptor`, `parameterizedRenderers` on `GenerateContractTypesOptions` |
| `framework-components/src/control-stack.ts` | `extractParameterizedRenderers`, `extractParameterizedTypeImports`, `parameterizedRenderers` and `parameterizedTypeImports` on `ControlStack` |
| `emitter/src/emit-types.ts` | `parameterizedRenderers` and `parameterizedTypeImports` on `EmitStackInput` |
| `emitter/src/emit.ts` | `parameterizedRenderers` and `parameterizedTypeImports` destructuring and threading |
| `emitter/src/generate-contract-dts.ts` | `parameterizedTypeImports` handling |
| Exports (`framework-components/src/exports/`) | Remove re-exports of deleted types |

### 5.3 Delete `parameterized` from descriptor metadata

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` — delete `parameterized` map, `renderJsonTypeExpression`, `isSafeTypeExpression`, `precisionRenderer`
- `packages/3-extensions/pgvector/src/core/descriptor-meta.ts` — delete `parameterized` map
- `packages/1-framework/1-core/framework-components/src/framework-components.ts` — remove `parameterized` from `ComponentMetadata.types.codecTypes`

### 5.4 Delete `parameterizedOutput` from `CodecTypes`

**Files:**
- `packages/3-targets/6-adapters/postgres/src/exports/codec-types.ts` — delete `parameterizedOutput` extensions on `pg/json@1` and `pg/jsonb@1`, delete `ResolveStandardSchemaOutput`, delete compile-time `StandardSchemaLike`
- `packages/3-extensions/pgvector/src/types/codec-types.ts` — delete `parameterizedOutput` on `pg/vector@1`

### 5.5 Update tests

- **Delete or rewrite:** `emitter-hook.parameterized-types.test.ts` — tests that asserted `parameterizedRenderers` flow are replaced by milestone 2 tests
- **Update:** `control-stack.test.ts` — remove `extractParameterizedRenderers` tests
- **Update:** `emitter.test.ts` — remove "passes parameterizedRenderers to generateContractTypes options" test
- **Update:** `emit-parameterized.test.ts` — remove any assertions about old rendering behavior, keep assertions about `FieldOutputTypes`
- **Update:** `contract-builder.types.test-d.ts` — delete `ResolveStandardSchemaOutput` type tests, update JSON Schema no-emit assertions to expect `JsonValue` instead of `unknown`
- **Update:** `compute-column-js-type.test-d.ts` — update fixtures to include `FieldOutputTypes`

### 5.6 Verify no remaining references

Grep for: `parameterizedRenderers`, `TypeRenderEntry`, `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`, `parameterizedOutput`, `ExtractParameterizedCodecOutputType`, `ResolveModelFieldToJsType`, `ResolveValueObjectJsType`, `RenderTypeContext`, `ParameterizedCodecDescriptor`, phantom `schema` key — no remaining references in source code (excluding docs and ADR historical context).

### Packages touched

| Package | Change |
|---------|--------|
| `@prisma-next/framework-components` | Delete `type-renderers.ts`, trim `emission-types.ts`, trim `control-stack.ts`, update exports |
| `@prisma-next/emitter` | Trim `emit-types.ts`, `emit.ts`, `generate-contract-dts.ts` |
| `@prisma-next/sql-contract-emitter` | Delete `generateModelsType` override |
| `@prisma-next/adapter-postgres` | Delete `parameterized` from descriptor, delete `parameterizedOutput` from `codec-types.ts`, delete phantom `schema` from `column-types.ts` |
| `@prisma-next/extension-pgvector` | Delete `parameterized` from descriptor, delete `parameterizedOutput` from `codec-types.ts` |
| `@prisma-next/sql-relational-core` | Delete `ExtractParameterizedCodecOutputType` (if not done in M3) |

---

## Test coverage summary

| Acceptance criterion | Test type | Milestone |
|---|---|---|
| `renderOutputType` on each parameterized codec produces correct type string | Unit | 1 |
| `renderOutputType` is optional — codecs without it return undefined | Unit | 1 |
| Safety: malicious type expressions rejected | Unit | 1 |
| Emitted `contract.d.ts` contains `FieldOutputTypes` export | Snapshot | 2 |
| `FieldOutputTypes` contains correct types for parameterized fields | Snapshot | 2 |
| `FieldOutputTypes` contains correct types for non-parameterized fields | Snapshot | 2 |
| Nullable fields have `\| null` in `FieldOutputTypes` | Snapshot | 2 |
| `ComputeColumnJsType` resolves from `FieldOutputTypes` | Type test | 3 |
| `ContractModelBase.fields` is `Record<string, ContractField>` | Typecheck | 3 |
| No-emit `vector(1536)` → `FieldOutputTypes` has `Vector<1536>` | Type test | 4 |
| No-emit `jsonb()` → `FieldOutputTypes` has `JsonValue` | Type test | 4 |
| No-emit `jsonb(schema)` does not regress (resolves to `JsonValue`) | Type test | 4 |
| SQL emitter `generateModelsType?` override deleted | Grep check | 5 |
| No remaining `parameterizedRenderers` references in source | Grep check | 5 |
| No remaining `parameterizedOutput` references in source | Grep check | 5 |
| All existing tests pass | Full suite | 5 |
| `pnpm build` succeeds | Build | 5 |
| `pnpm typecheck` succeeds | Typecheck | 5 |

## Packages touched (summary)

| Package | Layer | What changes |
|---------|-------|-------------|
| `@prisma-next/framework-components` | framework/core | Add `renderOutputType` to `Codec`. Delete `type-renderers.ts`, `extractParameterizedRenderers`, `parameterizedRenderers`/`parameterizedTypeImports` from `ControlStack`. Add `codecLookup` to `ControlStack`. |
| `@prisma-next/emitter` | framework/tooling | Add `codecLookup` to `EmitStackInput`. Add `generateFieldOutputTypesMap`. Add `isSafeTypeExpression`. Delete `parameterizedRenderers` threading. |
| `@prisma-next/contract` | framework/foundation | Tighten `ContractModelBase.fields` to `Record<string, ContractField>`. |
| `@prisma-next/sql-contract` | sql/core | Add `fieldOutputTypes` to `TypeMaps`, add `ExtractFieldOutputTypes`. |
| `@prisma-next/sql-contract-emitter` | sql/tooling | Delete `generateModelsType` override. Update `getTypeMapsExpression()`. |
| `@prisma-next/sql-contract-ts` | sql/authoring | Compute `FieldOutputTypes` in `staged-contract-types.ts`. |
| `@prisma-next/sql-relational-core` | sql/lanes | Simplify `ComputeColumnJsType` to read from `FieldOutputTypes`. Delete `ExtractParameterizedCodecOutputType`. |
| `@prisma-next/adapter-postgres` | targets/adapters | Implement `renderOutputType` on codecs. Delete `parameterized` from descriptor, `parameterizedOutput` from codec-types, phantom `schema` from column-types, `renderJsonTypeExpression`/`isSafeTypeExpression` from descriptor-meta. |
| `@prisma-next/extension-pgvector` | extensions | Implement `renderOutputType` on codec. Delete `parameterized` from descriptor, `parameterizedOutput` from codec-types. |
