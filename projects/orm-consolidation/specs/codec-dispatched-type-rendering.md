# Codec-Dispatched Type Rendering — Design Spec

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)
**ADR:** [ADR 186 — Codec-dispatched type rendering](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)

**Status:** Draft

## Summary

Move output type rendering onto codecs, emit resolved output types into a dedicated `FieldOutputTypes` map in `contract.d.ts`, keep `typeParams` truthful, and delete the legacy renderer infrastructure including the SQL emitter's `EmissionSpi.generateModelsType?` override.

## Prerequisites

- **TML-2206** (value objects & embedded documents) must land first. It restructures `ContractField` so its `type` field is a discriminated union (`ContractFieldType = ScalarFieldType | ValueObjectFieldType | UnionFieldType`), where `ScalarFieldType` carries `codecId` and `typeParams`. It also introduces `generateFieldResolvedType` in the framework emitter, which resolves the output type for all three field kinds.
- **TML-2215** (bug fix) has landed — `typeParams` and `typeRef` are emitted on storage columns and model fields.

## Design

### Two concepts, two locations

**Codec field configuration** — `typeParams` on `ScalarFieldType` (accessed via `field.type.typeParams`). How the codec is configured for this field. Runtime data, JSON-serializable, identical in `contract.json` and `contract.d.ts`.

**Field output type** — entry in the `FieldOutputTypes` map. What TypeScript type the field produces. Determined by the codec and its configuration.

These are deliberately separated. For JSON Schema columns, the runtime `typeParams` is `{ schemaJson: { type: 'object', properties: { ... } } }` while the output type is `{ name: string; age: number }`. Mixing them into one location would create a type lie — the d.ts `typeParams` wouldn't match the runtime value in `contract.json`.

### `FieldOutputTypes` map

A new type emitted alongside the contract, mapping `ModelName → FieldName → OutputType`:

```typescript
// contract.d.ts
export type FieldOutputTypes = {
  readonly User: {
    readonly id: number;
    readonly email: string;
    readonly embedding: Vector<1536>;
    readonly payload: { name: string };
    readonly role: 'USER' | 'ADMIN';
  };
};
```

Both paths produce it:

- **Emit path:** The framework emitter calls `codec.renderOutputType(typeParams)` for each field, falling back to a reference to `CodecTypes[codecId]['output']`. Stamps results into the map.
- **No-emit path:** The contract builder propagates type-level output types from column descriptors into the map.

`ComputeColumnJsType` reads from `FieldOutputTypes[ModelName][FieldName]`. One access pattern, all fields.

#### Placement

`FieldOutputTypes` is added to `TypeMaps` as a fourth member:

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

In the emitted `contract.d.ts`:

```typescript
export type FieldOutputTypes = { readonly User: { ... }; ... };
export type TypeMaps = TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes, FieldOutputTypes>;
```

### `renderOutputType` on the Codec interface

Optional method on the framework `Codec` base. Produces the TypeScript output type expression for a field given its `typeParams`:

```typescript
// framework-components/src/codec-types.ts
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

- When absent or returns `undefined`: emitter emits a type-level reference to `CodecTypes[codecId]['output']`.
- When present: emitter uses the returned string as the type expression in `FieldOutputTypes`.

#### Which codecs need `renderOutputType`

Codecs that need it are those whose output type varies per field based on `typeParams`. All existing parameterized renderers in descriptor metadata need migrating:

**From `adapter-postgres` descriptor metadata:**

| Codec ID | Current renderer | `renderOutputType` logic |
|---|---|---|
| `sql/char@1`, `pg/char@1` | `'Char<{{length}}>'` | `Char<${length}>` |
| `sql/varchar@1`, `pg/varchar@1` | `'Varchar<{{length}}>'` | `Varchar<${length}>` |
| `pg/numeric@1` | function: `Numeric<P>` or `Numeric<P, S>` | same |
| `pg/bit@1` | `'Bit<{{length}}>'` | `Bit<${length}>` |
| `pg/varbit@1` | `'VarBit<{{length}}>'` | `VarBit<${length}>` |
| `sql/timestamp@1`, `pg/timestamp@1` | `precisionRenderer('Timestamp')` | `Timestamp<${precision}>` |
| `pg/timestamptz@1` | `precisionRenderer('Timestamptz')` | `Timestamptz<${precision}>` |
| `pg/time@1` | `precisionRenderer('Time')` | `Time<${precision}>` |
| `pg/timetz@1` | `precisionRenderer('Timetz')` | `Timetz<${precision}>` |
| `pg/interval@1` | `precisionRenderer('Interval')` | `Interval<${precision}>` |
| `pg/enum@1` | function: literal union | `'USER' \| 'ADMIN'` |
| `pg/json@1`, `pg/jsonb@1` | `renderJsonTypeExpression` | calls `renderTypeScriptTypeFromJsonSchema` |

**From `extension-pgvector` descriptor metadata:**

| Codec ID | Current renderer | `renderOutputType` logic |
|---|---|---|
| `pg/vector@1` | `'Vector<{{length}}>'` | `Vector<${length}>` |

Non-parameterized codecs (e.g., `pg/int4@1`, `pg/text@1`, `pg/bool@1`) don't need it — the emitter falls back to `CodecTypes[codecId]['output']`.

### `typeParams` stays truthful

The `typeParams` on `ScalarFieldType` (i.e. `field.type.typeParams`) in `contract.d.ts` is always serialized from the runtime value — same as `contract.json`. For Vector: `{ readonly length: 1536 }`. For JSONB: `{ readonly schemaJson: { ... } }`. No transformations, no phantom types.

This means `ContractModelBase.fields` can be tightened back to `Record<string, ContractField>`. The widening to `Record<string, unknown>` (with its explanatory doc comment about "rendered types") was only needed because renderers replaced the field shape.

### `parameterizedOutput` is removed from `CodecTypes`

With `FieldOutputTypes` produced by both paths, there's no need for type-level output type computation. The `parameterizedOutput` function type and `ExtractParameterizedCodecOutputType` utility are deleted. `CodecTypes` retains `input`, `output`, and `traits` only.

The `output` key on `CodecTypes` remains — it's the codec's *default* output type, used by the emitter as a fallback when no `renderOutputType` is present.

### `EmissionSpi.generateModelsType?` override is removed (hard AC)

After TML-2206, model fields are self-contained — they carry resolved `codecId` and `typeParams` at build time. The SQL emitter's override (~110 lines that cross-reference model fields against storage columns) is deleted. The framework's `generateModelsType` handles all families.

### Framework emitter changes

TML-2206 introduced `generateFieldResolvedType` in `domain-type-generation.ts`, which already resolves the output type for all three field kinds: scalar → `CodecTypes[codecId]['output']`, value object → name reference, union → members joined. It also handles `many`, `dict`, and `nullable` modifiers.

This function is extended with codec dispatch for scalars. When a `CodecLookup` is provided:

1. For scalar fields with `typeParams`, looks up the codec via `CodecLookup`
2. Calls `codec.renderOutputType(field.type.typeParams)` if present
3. Uses the returned string as the output type expression (falling back to `CodecTypes[codecId]['output']` as before)
4. Stamps the result into `FieldOutputTypes`

Value object and union fields pass through unchanged — their output types don't depend on codecs.

The emitter generates the `FieldOutputTypes` map as a new `export type` in `contract.d.ts`.

#### `CodecLookup` in the emission pipeline

The control stack currently assembles `parameterizedRenderers` from descriptor metadata. After this change, it assembles a `CodecLookup` from the same descriptor sources — adapter and extension descriptors contribute codec instances.

`EmitStackInput` gains a `codecLookup?: CodecLookup` field. The `CodecLookup` interface already exists in `framework-components/src/codec-types.ts`.

Descriptor metadata needs a new contribution point: `types.codecTypes.codecs` (a `Codec[]` or `Record<string, Codec>`) alongside the existing `import`, `typeImports`, and `parameterized` (which is deleted). Alternatively, `createControlStack` can assemble the lookup by iterating adapter/extension codec registries if those are accessible. The exact assembly mechanism should be decided during implementation.

### `ComputeColumnJsType` simplification

Today, `ComputeColumnJsType` in `relational-core/src/types.ts` is a ~50-line conditional type that:
1. Tries `ExtractColumnJsTypeFromModels` → `ResolveModelFieldToJsType`, which branches on `field.type.kind`: scalar → `CodecTypes[codecId]['output']`, valueObject → `ResolveValueObjectJsType`, union → `unknown`
2. Falls back to storage column resolution with `ExtractParameterizedCodecOutputType`

After this change, it reads from `FieldOutputTypes[ModelName][FieldName]`. The `ExtractParameterizedCodecOutputType` branch, `ResolveColumnTypeParams`, and `ResolveModelFieldToJsType` helpers are deleted. The entire chain is replaced by a direct map lookup, since `FieldOutputTypes` already contains resolved types for all field kinds (scalar, value object, union) with `many`/`dict`/`nullable` modifiers applied.

### No-emit path

The no-emit contract builder in `staged-contract-types.ts` produces `SqlContractResult` which wraps the built contract with `TypeMaps`. Today it computes `CodecTypes` from the staged definition.

After this change, it also computes `FieldOutputTypes` from the staged definition — collecting each column's output type (from the column descriptor's type-level information) into the map. For a non-parameterized column, the output type comes from `CodecTypes[codecId]['output']`. For a parameterized column like `vector(1536)`, the column descriptor carries the output type (`Vector<1536>`) at the type level, and the builder propagates it into `FieldOutputTypes`.

The phantom `schema` key on `TypedColumnDescriptor` (used by `parameterizedOutput` for JSON Schema) is deleted along with `parameterizedOutput`. The no-emit path for JSON Schema columns will resolve to the codec's default output type (`JsonValue`) until dedicated type-level JSON Schema resolution is implemented (tracked separately).

## Infrastructure deleted

| What | Where |
|------|-------|
| `TypeRenderer`, `TypeRendererString`, `TypeRendererRawFunction`, `TypeRendererTemplate`, `TypeRendererFunction` | `framework-components/src/type-renderers.ts` |
| `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate` | `framework-components/src/type-renderers.ts` |
| `RenderTypeContext` | `framework-components/src/type-renderers.ts` |
| `TypeRenderEntry`, `ParameterizedCodecDescriptor` | `framework-components/src/emission-types.ts` |
| `extractParameterizedRenderers` | `framework-components/src/control-stack.ts` |
| `extractParameterizedTypeImports` | `framework-components/src/control-stack.ts` |
| `parameterizedRenderers` on `ControlStack`, `EmitStackInput`, `GenerateContractTypesOptions` | Multiple files |
| `parameterizedTypeImports` on `ControlStack`, `EmitStackInput`, `GenerateContractTypesOptions` | Multiple files |
| `parameterized` maps in descriptor metadata | `adapter-postgres/src/core/descriptor-meta.ts`, `pgvector/src/core/descriptor-meta.ts` |
| `renderJsonTypeExpression`, `isSafeTypeExpression` | `adapter-postgres/src/core/descriptor-meta.ts` |
| `EmissionSpi.generateModelsType?` | `framework-components/src/emission-types.ts` |
| SQL emitter's `generateModelsType` override | `sql-contract-emitter/src/index.ts` |
| `parameterizedOutput` on `CodecTypes` entries | `adapter-postgres/src/exports/codec-types.ts`, `pgvector/src/types/codec-types.ts` |
| `ResolveStandardSchemaOutput`, compile-time `StandardSchemaLike` | `adapter-postgres/src/exports/codec-types.ts` |
| `ExtractParameterizedCodecOutputType`, `ResolveModelFieldToJsType`, `ResolveValueObjectJsType` | `relational-core/src/types.ts` |
| Phantom `schema` key on `TypedColumnDescriptor` | `adapter-postgres/src/exports/column-types.ts` |

## `typeImports` remain on descriptor metadata

Adapters and extensions still contribute import specs for types referenced by rendered type expressions (`Char`, `Vector`, `JsonValue`, etc.) via `types.codecTypes.typeImports` on descriptor metadata. Moving type imports onto codecs is a nice-to-have for a future pass.

## Worked examples

### Vector column

**Authoring:**
```typescript
.column('embedding', { type: vector(1536), nullable: false })
// typeParams = { length: 1536 }
```

**Emit path:**
1. Emitter looks up `pg/vector@1` codec, calls `renderOutputType({ length: 1536 })` → `'Vector<1536>'`
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/vector@1'; readonly typeParams: { readonly length: 1536 } } }`
3. Emitted `FieldOutputTypes`: `readonly embedding: Vector<1536>`

**No-emit path:**
- `vector(1536)` column descriptor carries `Vector<1536>` at the type level
- Contract builder collects it into `FieldOutputTypes`

### JSON Schema column

**Authoring:**
```typescript
const payloadSchema = arktype({ action: 'string', actorId: 'number' });
.column('payload', { type: jsonb(payloadSchema), nullable: false })
// typeParams = { schemaJson: { type: 'object', properties: { action: { type: 'string' }, actorId: { type: 'number' } } } }
```

**Emit path:**
1. Emitter looks up `pg/jsonb@1` codec, calls `renderOutputType({ schemaJson: { ... } })` → `'{ action: string; actorId: number }'`
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/jsonb@1'; readonly typeParams: { readonly schemaJson: { ... } } } }` (truthful)
3. Emitted `FieldOutputTypes`: `readonly payload: { action: string; actorId: number }`

**No-emit path:**
- After removing phantom `schema` key and `parameterizedOutput`, JSON Schema columns in the no-emit path resolve to `JsonValue` (the codec's default output type)
- This is not a regression — the no-emit path was already broken for JSON Schema (resolved to `unknown`)

### Enum column

**Authoring:**
```typescript
.column('role', { type: pgEnum(['USER', 'ADMIN']), nullable: false })
// typeParams = { values: ['USER', 'ADMIN'] }
```

**Emit path:**
1. Emitter looks up `pg/enum@1` codec, calls `renderOutputType({ values: ['USER', 'ADMIN'] })` → `"'USER' | 'ADMIN'"`
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/enum@1'; readonly typeParams: { readonly values: readonly ['USER', 'ADMIN'] } } }`
3. Emitted `FieldOutputTypes`: `readonly role: 'USER' | 'ADMIN'`

### Non-parameterized column

**Authoring:**
```typescript
.column('email', { type: text(), nullable: false })
// No typeParams
```

**Emit path:**
1. `pg/text@1` codec has no `renderOutputType` → emitter emits a reference to `CodecTypes['pg/text@1']['output']`
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' } }`
3. Emitted `FieldOutputTypes`: `readonly email: string` (resolved via `CodecTypes` reference)

## Open questions

### `isSafeTypeExpression` for `renderOutputType`

The current `renderJsonTypeExpression` in descriptor-meta validates rendered type expressions against injection patterns (`import(`, `require(`, etc.). This safety check needs to be preserved — either inside each codec's `renderOutputType`, as a shared utility called by the emitter after receiving the rendered string, or as a wrapper in the framework. A shared utility the emitter applies seems cleanest.

### No-emit JSON Schema type resolution

Removing the phantom `schema` key means the no-emit path loses JSON Schema type inference (which was already broken end-to-end). A future pass could add a type-level `renderOutputType` equivalent that works at compile time, but this is out of scope for TML-2204.

## Related work

- **TML-2206 (Value objects):** Must land first. Restructures `ContractField`, ensures model fields are self-contained at build time.
- **TML-2215 (Bug fix):** Already landed. Restored emission of `typeParams` and `typeRef`.
- **ADR 184 (Codec-owned value serialization):** Established the pattern of codecs owning their representations.
- **ADR 186 (Codec-dispatched type rendering):** The architectural decision this spec implements.
