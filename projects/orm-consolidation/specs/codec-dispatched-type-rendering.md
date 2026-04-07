# Codec-Dispatched Type Rendering — Design Spec

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)
**ADR:** [ADR 186 — Codec-dispatched type rendering](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)

**Status:** Draft

## Summary

Move output type rendering onto codecs, emit resolved output types into a dedicated `FieldOutputTypes` map in `contract.d.ts`, keep `typeParams` truthful, and delete the legacy renderer infrastructure including the SQL emitter's `EmissionSpi.generateModelsType?` override.

## Two concepts, two locations

**Codec field configuration** — `typeParams` on the `ContractField`. How the codec is configured for this field. Runtime data, JSON-serializable, identical in `contract.json` and `contract.d.ts`. Examples: `{ length: 1536 }` for Vector, `{ schemaJson: { ... } }` for typed JSON, `{ values: ['USER', 'ADMIN'] }` for Enum.

**Field output type** — entry in the `FieldOutputTypes` map. What TypeScript type the field produces. Determined by the codec and its configuration. Resolved by the emitter (emit path) or the contract builder (no-emit path). Examples: `Vector<1536>`, `{ name: string }`, `'USER' | 'ADMIN'`.

## `FieldOutputTypes` map

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
- **Emit:** The emitter calls `codec.renderOutputType(typeParams)` for each field, falling back to `CodecTypes[codecId]['output']` as a type reference. Stamps results into the map.
- **No-emit:** The contract builder propagates type-level output types from column descriptors into the map.

`ComputeColumnJsType` reads from `FieldOutputTypes[ModelName][FieldName]`. One access pattern, all fields.

## `renderOutputType` on the Codec interface

Optional method. Produces the TypeScript output type expression for a field given its `typeParams`:

```typescript
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

- When absent or returns `undefined`: emitter falls back to `CodecTypes[codecId]['output']` as a type reference.
- When present: emitter uses the returned string as the type expression in `FieldOutputTypes`.

### Examples

```typescript
// pg/vector@1 — no renderOutputType needed; most codecs are like this
// Emitter falls back to CodecTypes['pg/vector@1']['output'] → number[]
// BUT: if typeParams has { length: 1536 }, we want Vector<1536>, not number[]
// So Vector DOES need renderOutputType:
renderOutputType(typeParams) {
  const length = typeParams['length'];
  return typeof length === 'number' ? `Vector<${length}>` : undefined;
}

// pg/jsonb@1 — transforms JSON Schema into TypeScript type
renderOutputType(typeParams) {
  const schemaJson = typeParams['schemaJson'];
  if (schemaJson && typeof schemaJson === 'object') {
    return renderTypeFromJsonSchema(schemaJson);
  }
  return undefined; // fallback to JsonValue
}

// pg/enum@1 — renders literal union from values
renderOutputType(typeParams) {
  const values = typeParams['values'];
  if (Array.isArray(values) && values.length > 0) {
    return values.map(v => `'${v}'`).join(' | ');
  }
  return undefined; // fallback to string
}

// sql/char@1 — renders branded Char<N>
renderOutputType(typeParams) {
  const length = typeParams['length'];
  return typeof length === 'number' ? `Char<${length}>` : undefined;
}

// pg/int4@1 — no typeParams, no renderOutputType needed
// Emitter uses CodecTypes['pg/int4@1']['output'] → number
```

## `typeParams` stays truthful

The `typeParams` on `ContractField` in the d.ts is always serialized from the runtime value — same as `contract.json`. For Vector: `{ readonly length: 1536 }`. For JSONB: `{ readonly schemaJson: { ... } }`. No transformations, no phantom types.

This means `ContractModelBase.fields` can be tightened back to `Record<string, ContractField>`.

## `parameterizedOutput` is removed from `CodecTypes`

With `FieldOutputTypes` produced by both paths, there's no need for type-level output type computation. The `parameterizedOutput` function type and `ExtractParameterizedCodecOutputType` utility are deleted. `CodecTypes` retains `input`, `output`, and `traits` only.

The `output` key on `CodecTypes` remains — it's the codec's *default* output type, used by the emitter as a fallback when no `renderOutputType` is present.

## `EmissionSpi.generateModelsType?` override is removed (hard AC)

After TML-2206, model fields are self-contained. The SQL emitter's override is deleted. The framework's `generateModelsType` handles all families.

## Framework emitter changes

The framework emitter's field generation:

1. For each model field, reads `codecId` and `typeParams`
2. Looks up the codec via `CodecLookup`
3. Calls `codec.renderOutputType(typeParams)` if present; otherwise uses `CodecTypes[codecId]['output']` as a type reference
4. Stamps the result into `FieldOutputTypes`
5. Serializes `typeParams` truthfully as const literals on the field

The emitter generates the `FieldOutputTypes` map as a new `export type` in `contract.d.ts`.

### Codec lookup in the emission pipeline

`EmitStackInput` is widened to include a `CodecLookup`. The control stack assembles it from adapter and extension pack descriptors during stack creation.

## Dead infrastructure

All of the following are removed:

| What | Where |
|------|-------|
| `TypeRenderer`, `TypeRendererString`, `TypeRendererRawFunction`, `TypeRendererTemplate`, `TypeRendererFunction` | `framework-components/src/type-renderers.ts` |
| `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate` | `framework-components/src/type-renderers.ts` |
| `RenderTypeContext` | `framework-components/src/type-renderers.ts` |
| `TypeRenderEntry`, `ParameterizedCodecDescriptor` | `framework-components/src/emission-types.ts` |
| `extractParameterizedRenderers` | `framework-components/src/control-stack.ts` |
| `parameterizedRenderers` on control stack, `EmitStackInput`, `GenerateContractTypesOptions` | Multiple files |
| `parameterized` maps in descriptor metadata | `adapter-postgres/src/core/descriptor-meta.ts`, `pgvector/src/core/descriptor-meta.ts` |
| `EmissionSpi.generateModelsType?` | `framework-components/src/emission-types.ts` |
| SQL emitter's `generateModelsType` override | `sql-contract-emitter/src/index.ts` |
| `renderJsonTypeExpression`, `isSafeTypeExpression` from descriptor-meta | `adapter-postgres/src/core/descriptor-meta.ts` |
| `parameterizedOutput` on `CodecTypes` entries | `adapter-postgres/src/exports/codec-types.ts`, `pgvector/src/types/codec-types.ts` |
| `ExtractParameterizedCodecOutputType` | `sql-relational-core/src/ast/codec-types.ts` |

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
2. Emitted d.ts field: `{ readonly codecId: 'pg/vector@1'; readonly nullable: false; readonly typeParams: { readonly length: 1536 } }`
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
2. Emitted d.ts field: `{ readonly codecId: 'pg/jsonb@1'; readonly nullable: false; readonly typeParams: { readonly schemaJson: { ... } } }` (truthful)
3. Emitted `FieldOutputTypes`: `readonly payload: { action: string; actorId: number }`

**No-emit path:**
- `jsonb(payloadSchema)` column descriptor carries `{ action: string; actorId: number }` via Arktype's `.infer`
- Contract builder collects it into `FieldOutputTypes`

### Enum column

**Authoring:**
```typescript
.column('role', { type: pgEnum(['USER', 'ADMIN']), nullable: false })
// typeParams = { values: ['USER', 'ADMIN'] }
```

**Emit path:**
1. Emitter looks up `pg/enum@1` codec, calls `renderOutputType({ values: ['USER', 'ADMIN'] })` → `"'USER' | 'ADMIN'"`
2. Emitted d.ts field: `{ readonly codecId: 'pg/enum@1'; readonly nullable: false; readonly typeParams: { readonly values: readonly ['USER', 'ADMIN'] } }`
3. Emitted `FieldOutputTypes`: `readonly role: 'USER' | 'ADMIN'`

### Non-parameterized column

**Authoring:**
```typescript
.column('email', { type: text(), nullable: false })
// No typeParams
```

**Emit path:**
1. `pg/text@1` codec has no `renderOutputType` → emitter uses `CodecTypes['pg/text@1']['output']` → `string`
2. Emitted d.ts field: `{ readonly codecId: 'pg/text@1'; readonly nullable: false }`
3. Emitted `FieldOutputTypes`: `readonly email: string`

### ID column with @prisma-next/ids

**Authoring:**
```typescript
.column('id', { ...uuidv4(), nullable: false })
// codecId = 'sql/char@1', typeParams = { length: 36 }
```

**Emit path:**
1. Emitter looks up `sql/char@1` codec, calls `renderOutputType({ length: 36 })` → `'Char<36>'`
2. Emitted d.ts field: `{ readonly codecId: 'sql/char@1'; readonly nullable: false; readonly typeParams: { readonly length: 36 } }`
3. Emitted `FieldOutputTypes`: `readonly id: Char<36>`

## Open questions

### `typeImports` cleanup

After deleting `parameterizedRenderers`, the `parameterizedTypeImports` mechanism may still be needed or can be folded into the existing `codecTypeImports`. Evaluate during implementation.

### Fixing the no-emit plumbing for JSON Schema

The phantom `schema` key plumbing is broken end-to-end — the integration type test asserts `unknown`, not the schema-derived type. Fixing this is orthogonal to TML-2204 but should be tracked.

### `FieldOutputTypes` placement

Should `FieldOutputTypes` be a standalone export in `contract.d.ts`, or part of `TypeMaps`? `TypeMaps` already carries `CodecTypes` and `OperationTypes`. Adding `FieldOutputTypes` to it would keep all type-level metadata in one place. Evaluate during implementation.

## Relationship to other work

- **TML-2206 (Value objects):** Must land first. Restructures `ContractField` into a discriminated union with `ScalarFieldType` (which carries `typeParams`), ensures model fields are self-contained at build time.
- **TML-2215 (Bug fix):** Already landed. Restored emission of `typeParams` and `typeRef` on storage columns and model fields.
- **ADR 184 (Codec-owned value serialization):** Established the pattern of codecs owning their representations (`encodeJson`/`decodeJson`). This design extends the pattern to type rendering.
- **ADR 186 (Codec-dispatched type rendering):** The architectural decision this spec implements.
