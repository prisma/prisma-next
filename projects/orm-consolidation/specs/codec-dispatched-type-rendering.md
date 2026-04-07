# Codec-Dispatched Type Rendering — Design

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)

**Status:** Draft

## Problem

Type rendering for parameterized codecs is scattered across multiple systems, couples the SQL emitter to storage internals, and conflates runtime values with compile-time types.

### Current state

Three independent systems participate in resolving a codec's output type in the emitted `contract.d.ts`:

1. **`CodecTypes` module augmentation** — Each adapter/extension exports a `CodecTypes` type that maps `codecId → { input, output, traits }`. The emitter intersects them into a single `CodecTypes` alias. `ComputeColumnJsType` resolves the JS type via `CodecTypes[codecId]['output']`. Works for non-parameterized codecs.

2. **`parameterized` renderers in descriptor metadata** — Adapter/extension descriptors register a `parameterized` map: `codecId → TypeRenderer`. These renderer functions produce TypeScript type expression *strings* (like `'Char<5>'`, `"'USER' | 'ADMIN'"`) at emit time. The framework normalizes them (`TypeRenderer` → `NormalizedTypeRenderer`), extracts them onto the control stack, and threads them through `EmitStackInput` → `emit()` → `GenerateContractTypesOptions` → `EmissionSpi.generateModelsType()`. Four different type shapes (`string`, raw function, `{kind:'template'}`, `{kind:'function'}`) are normalized to one.

3. **`parameterizedOutput` on `CodecTypes`** — Some `CodecTypes` entries carry a `parameterizedOutput` function type that takes `typeParams` and returns a resolved type. This is the no-emit type-level resolution path. Used by `ComputeColumnJsType` via `ExtractParameterizedCodecOutputType`.

### What's wrong

- **Renderers replace the entire field type in contract.d.ts.** When a parameterized renderer fires, it emits `readonly payload: AuditPayload` instead of preserving the structural `ContractField` shape. This breaks any code that expects model fields to conform to `ContractField`. The renderer should only affect the *output type* portion.

- **Renderers are registered in descriptor metadata, not on the codec.** The codec is the natural owner of "how to represent my type" — it already owns wire representation (`encode`/`decode`) and JSON serialization (`encodeJson`/`decodeJson`). Type rendering is the missing piece.

- **The SQL emitter overrides `EmissionSpi.generateModelsType?`.** The only reason it does this is to inject renderer dispatch and to cross-reference model fields against storage columns (deriving `codecId` and `typeParams` from the storage layer). After TML-2206, model fields carry their own `type: ScalarFieldType` with `codecId` and `typeParams` resolved at build time, so the storage cross-referencing is redundant. The override duplicates ~110 lines of the framework's 37-line default and makes `EmissionSpi` harder to maintain.

- **The `TypeRenderer` union is over-engineered.** Four input shapes (`string`, raw function, `{kind:'template'}`, `{kind:'function'}`) normalized to one, plus a `RenderTypeContext` that always carries `codecTypesName: 'CodecTypes'`.

- **Two parallel type resolution mechanisms have no common abstraction.** The renderer (emit-time string) and `parameterizedOutput` (type-level function) serve the same purpose in different contexts but share no interface or contract.

## Design

### Core model: two parallel representations of type parameters

A parameterized codec has type parameters that determine its output type. These type parameters exist in two parallel representations:

1. **Runtime values** — stored in `typeParams` on the contract field. Serialized into `contract.json`. Example: `{ length: 1536 }` for Vector, `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }` for typed JSON.

2. **Type-level values** — what appears in `contract.d.ts` as TypeScript literal types. These are what the parameterized output type on `CodecTypes` consumes to compute the output type.

The **mapping from runtime values to type-level values is codec-controlled**:

- **Default (most codecs):** Identity — the runtime values are serialized as const literal types by the emitter. `{ length: 1536 }` → `{ readonly length: 1536 }`. The parameterized output type computes the result: `P extends { length: infer L extends number } ? Vector<L> : number[]`.

- **JSON Schema:** A transformation — the runtime JSON Schema value (in `typeParams.schemaJson`) is converted into the TypeScript output type at authoring/emission time. The type-level typeParams carry the *result* of that transformation. The parameterized output type simply extracts it.

This is not a special case or escape hatch. It's the same architecture — a codec declares a parameterized output type and controls how its runtime type parameters are rendered as type-level values. The JSON Schema codec simply uses a non-identity rendering function.

### Parameterized output types on `CodecTypes`

Every parameterized codec declares a parameterized output type: a type-level function from type-level typeParams to the codec's output type. This is the **single mechanism** for resolving output types, in both emit and no-emit paths.

Examples:

```typescript
// Vector: length → Vector<L>
type VectorOutput<P> = P extends { readonly length: infer L extends number }
  ? Vector<L>
  : number[];

// Char: length → Char<L>
type CharOutput<P> = P extends { readonly length: infer L extends number }
  ? Char<L>
  : string;

// Enum: values → literal union
type EnumOutput<P> = P extends { readonly values: readonly (infer V extends string)[] }
  ? V
  : string;

// Numeric: precision, optional scale
type NumericOutput<P> = P extends { readonly precision: infer Pr extends number; readonly scale: infer S extends number }
  ? Numeric<Pr, S>
  : P extends { readonly precision: infer Pr extends number }
    ? Numeric<Pr>
    : string;

// JSONB with rendered schema: output type carried directly in typeParams
type JsonbOutput<P> = P extends { readonly schema: infer Schema }
  ? Schema extends { readonly infer: infer Output } ? Output     // no-emit: Arktype .infer
    : Schema extends { readonly '~standard': { readonly types?: { readonly output?: infer Output } } }
      ? Output extends undefined ? JsonValue : Output              // no-emit: Standard Schema
      : JsonValue
  : P extends { readonly outputType: infer O }                     // emit: rendered type
    ? O
    : JsonValue;
```

These are declared by the codec's type-only export (e.g., `@prisma-next/adapter-postgres/codec-types`, `@prisma-next/extension-pgvector/codec-types`) and emitted into `contract.d.ts` via the existing `CodecTypes` intersection mechanism.

### TypeParams rendering: codec-controlled mapping

The emitter serializes each field's `typeParams` into the d.ts as type-level values. By default, this is const literal serialization (identity mapping). Codecs that need a non-identity mapping provide a **typeParams rendering function** on the codec object:

```typescript
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...

  /**
   * Transforms runtime typeParams into their type-level representation
   * for contract.d.ts emission. Called by the emitter for each field
   * with typeParams that references this codec.
   *
   * Return undefined to use the default const literal serialization.
   */
  emitTypeParams?(typeParams: Record<string, unknown>): Record<string, unknown> | undefined;
}
```

For JSON Schema codecs, this function converts `typeParams.schemaJson` (the serialized JSON Schema) into a TypeScript type expression and returns it as a type-level value:

```typescript
// pg/jsonb@1 codec:
renderTypeParams(typeParams: Record<string, unknown>): Record<string, unknown> | undefined {
  const schemaJson = typeParams['schemaJson'];
  if (schemaJson && typeof schemaJson === 'object') {
    const tsType = renderTypeScriptTypeFromJsonSchema(schemaJson);
    return { outputType: tsType };
  }
  return undefined; // fall back to default serialization
}
```

The emitter then serializes the *returned* value (not the original runtime value) as the type-level typeParams in the d.ts. The parameterized output type on `CodecTypes` receives the transformed value and resolves the output type.

For the **no-emit path**, no rendering function is called. The authoring surface captures the type-level values directly — e.g., the phantom `schema` key on `TypedColumnDescriptor` carries the original Arktype/Zod schema object's TypeScript type, and `parameterizedOutput` extracts the output type via `.infer` or `~standard.types.output`.

### Structural field shape is always preserved

The emitter always emits model fields with the structural `ContractField` shape — `{ nullable, type: { kind: 'scalar', codecId, typeParams } }`. The rendered typeParams (with transformed type-level values where applicable) go inside this shape. The renderer never replaces the entire field.

This means `ContractModelBase.fields` can be tightened back to `Record<string, ContractField>` — the widening to `Record<string, unknown>` was only needed because renderers replaced the field shape.

### `EmissionSpi.generateModelsType?` override is removed

After TML-2206, model fields carry their own `type: ScalarFieldType` with `codecId` and `typeParams` resolved at build time. The SQL emitter's `generateModelsType` override was only needed to:

1. Cross-reference storage columns to derive `codecId`/`typeParams` — redundant after TML-2206
2. Resolve `typeRef` → `typeParams` — done at build time after TML-2206
3. Dispatch parameterized renderers — moved to the framework emitter

With all three reasons removed, the override is deleted. The framework's `generateModelsType` (and its `generateModelFieldEntry` / `generateFieldResolvedType` helpers) handles all families. This is a hard acceptance criterion.

### Framework emitter owns typeParams rendering

The framework emitter's field generation logic:

1. For each `ScalarFieldType` with `typeParams`, looks up the codec via `CodecLookup`
2. If the codec has `renderTypeParams`, calls it to transform the runtime typeParams
3. Serializes the (possibly transformed) typeParams as type-level literal values in the d.ts
4. The parameterized output type on `CodecTypes` resolves the output type at the type level

This logic lives in the framework layer (`@prisma-next/emitter`), benefiting all families (SQL, Mongo) and all field contexts (model fields, value object fields, union members).

### Codec lookup in the emission pipeline

The emitter needs access to codec objects to call `renderTypeParams`. The emission pipeline's `EmitStackInput` is widened to include a `CodecLookup` (or the full `CodecRegistry`). The control stack already receives the adapter and extension pack descriptors, so it can assemble the codec lookup during stack creation.

### Dead infrastructure is deleted

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

### `typeImports` remain on descriptor metadata

Adapters and extensions still contribute import specs for types referenced by rendered type expressions (`Char`, `Vector`, `JsonValue`, etc.) via `types.codecTypes.typeImports` on descriptor metadata. These are decoupled from the renderer infrastructure — they're just type import declarations.

Moving type imports onto codecs (so each codec declares its own imports) is a nice-to-have for a future pass.

## Worked examples

### Vector column (default typeParams rendering)

**Authoring:**
```typescript
.column('embedding', { type: vector(1536), nullable: false })
// typeParams = { length: 1536 }
```

**Emit path:**
1. `pg/vector@1` codec has no `renderTypeParams` → default const literal serialization
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/vector@1'; readonly typeParams: { readonly length: 1536 } } }`
3. `ComputeColumnJsType` calls `CodecTypes['pg/vector@1']['parameterizedOutput']` with `{ readonly length: 1536 }` → `Vector<1536>`

**No-emit path:**
- Same mechanism — `parameterizedOutput` resolves `Vector<1536>` from the type-level typeParams

### JSON Schema column (custom typeParams rendering)

**Authoring:**
```typescript
const payloadSchema = arktype({ action: 'string', actorId: 'number' });
.column('payload', { type: jsonb(payloadSchema), nullable: false })
// Runtime typeParams = { schemaJson: { type: 'object', properties: { action: { type: 'string' }, actorId: { type: 'number' } } } }
```

**Emit path:**
1. `pg/jsonb@1` codec has `renderTypeParams` → transforms `{ schemaJson: ... }` into `{ outputType: '{ action: string; actorId: number }' }` (type expression string)
2. Emitter serializes the transformed value: `{ readonly outputType: { action: string; actorId: number } }` (note: the string becomes an actual TypeScript type in the d.ts)
3. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/jsonb@1'; readonly typeParams: { readonly outputType: { action: string; actorId: number } } } }`
4. `ComputeColumnJsType` calls `CodecTypes['pg/jsonb@1']['parameterizedOutput']` with `{ readonly outputType: { action: string; actorId: number } }` → extracts `{ action: string; actorId: number }`

**No-emit path:**
- Phantom `schema` key carries the Arktype schema's TypeScript type
- `parameterizedOutput` extracts the output type via `.infer` → `{ action: string; actorId: number }`

### Enum column (default typeParams rendering)

**Authoring:**
```typescript
.column('role', { type: pgEnum(['USER', 'ADMIN']), nullable: false })
// typeParams = { values: ['USER', 'ADMIN'] }
```

**Emit path:**
1. `pg/enum@1` codec has no `renderTypeParams` → default const literal serialization
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/enum@1'; readonly typeParams: { readonly values: readonly ['USER', 'ADMIN'] } } }`
3. `ComputeColumnJsType` calls `CodecTypes['pg/enum@1']['parameterizedOutput']` with `{ readonly values: readonly ['USER', 'ADMIN'] }` → `'USER' | 'ADMIN'`

### ID column with @prisma-next/ids (default typeParams rendering)

**Authoring:**
```typescript
.column('id', { ...uuidv4(), nullable: false })
// codecId = 'sql/char@1', typeParams = { length: 36 }
```

**Emit path:**
1. `sql/char@1` codec has no `renderTypeParams` → default const literal serialization
2. Emitted d.ts field: `{ readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'sql/char@1'; readonly typeParams: { readonly length: 36 } } }`
3. `ComputeColumnJsType` calls `CodecTypes['sql/char@1']['parameterizedOutput']` with `{ readonly length: 36 }` → `Char<36>`

## Open questions

### `renderTypeParams` return value for JSON Schema

The JSON Schema `renderTypeParams` needs to return a value where one key contains a TypeScript *type*, not a JSON value. The emitter must serialize this key differently — as an inline TypeScript type expression, not a const literal. The exact mechanism for this (a special marker type? a convention on the key name? a separate return field?) needs to be resolved during implementation.

### `extractParameterizedTypeImports` / `typeImports` cleanup

After deleting `parameterizedRenderers`, the `parameterizedTypeImports` mechanism may still be needed or can be folded into the existing `codecTypeImports`. This should be evaluated during implementation.

### Fixing the no-emit plumbing for JSON Schema

The phantom `schema` key plumbing is broken end-to-end — the integration type test asserts `unknown`, not the schema-derived type. Fixing this is orthogonal to TML-2204 (it's a plumbing bug in the contract builder → validate → query pipeline) but should be tracked.

## Relationship to other work

- **TML-2206 (Value objects):** Must land first. It restructures `ContractField` into a discriminated union with `ScalarFieldType` (which carries `typeParams`), and ensures model fields are self-contained at build time.
- **TML-2215 (Bug fix):** Already landed. Restored emission of `typeParams` and `typeRef` on storage columns and model fields.
- **ADR 184 (Codec-owned value serialization):** Established the pattern of codecs owning their representations (`encodeJson`/`decodeJson`). This design extends the pattern to type rendering.
