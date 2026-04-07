# ADR 186 — Codec-dispatched type rendering

## At a glance

A column with `codecId: "pg/vector@1"` and `typeParams: { length: 1536 }` needs its output type in `contract.d.ts` to be `Vector<1536>`, not the generic `number[]`. The codec owns this — it already owns wire encoding (`encode`/`decode`) and JSON serialization (`encodeJson`/`decodeJson`). Type rendering is the same responsibility for a different medium.

Today, a `vector(1536)` column's d.ts type is resolved through three independent systems working in concert: a `CodecTypes` type map, a `parameterized` renderer registered in descriptor metadata, and a `parameterizedOutput` type-level function. The renderer fires at emit time, replaces the entire field shape with a raw type expression, and is dispatched by the SQL emitter via an `EmissionSpi.generateModelsType` override that cross-references storage columns. None of this belongs in the family emitter.

After this change, the codec controls how its runtime `typeParams` are rendered as type-level values in the d.ts. The emitter serializes the rendered values into the structural `ContractField` shape, and a single `parameterizedOutput` type on `CodecTypes` resolves the output type — in both emit and no-emit paths.

```ts
// pg/vector@1 codec — no renderTypeParams needed (identity is the default)
const pgVectorCodec = codec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  encode: (value: number[]): string => `[${value.join(',')}]`,
  decode: (wire: string): number[] => { /* ... */ },
});

// pg/jsonb@1 codec — non-identity mapping for JSON Schema
const pgJsonbCodec = codec({
  typeId: 'pg/jsonb@1',
  targetTypes: ['jsonb'],
  traits: ['equality'],
  encode: (value): string => JSON.stringify(value),
  decode: (wire): JsonValue => typeof wire === 'string' ? JSON.parse(wire) : wire,
  renderTypeParams(typeParams) {
    const schemaJson = typeParams['schemaJson'];
    if (schemaJson && typeof schemaJson === 'object') {
      return { outputType: renderTypeFromJsonSchema(schemaJson) };
    }
    return undefined; // default serialization
  },
});
```

The emitted d.ts preserves the structural field shape. For a `vector(1536)` column:

```ts
// contract.d.ts — field preserves ContractField structure
readonly embedding: {
  readonly nullable: false;
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: 'pg/vector@1';
    readonly typeParams: { readonly length: 1536 };
  };
};
```

`ComputeColumnJsType` resolves the output type via `CodecTypes['pg/vector@1']['parameterizedOutput']` with `{ readonly length: 1536 }`, yielding `Vector<1536>`.

## Context

Codecs already own three of the four representations of a type:

| Representation | Owner | Method |
|---|---|---|
| Wire format (driver ↔ database) | Codec | `encode` / `decode` |
| Contract JSON (serialized values) | Codec | `encodeJson` / `decodeJson` ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md)) |
| DDL string (migration SQL) | Target-layer codec hook | `expandNativeType` ([ADR 171](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md)) |
| **TypeScript type in contract.d.ts** | **Scattered** | Three systems (see below) |

The fourth representation — the TypeScript output type emitted into `contract.d.ts` — is the only one not owned by the codec. Instead, it involves:

1. **`CodecTypes` module augmentation.** Each adapter/extension exports a `CodecTypes` mapping (`codecId → { input, output, traits }`). The emitter intersects them. `ComputeColumnJsType` resolves the JS type via `CodecTypes[codecId]['output']`. This works for non-parameterized codecs.

2. **`parameterized` renderers in descriptor metadata.** Adapter/extension descriptors register a map of `codecId → TypeRenderer`. These produce TypeScript type expression *strings* at emit time. The framework normalizes four different input shapes (`string`, raw function, `{kind:'template'}`, `{kind:'function'}`) to one, threads them through the control stack, and passes them to `EmissionSpi.generateModelsType()`.

3. **`parameterizedOutput` on `CodecTypes`.** A type-level function from `typeParams` to output type. This is the no-emit path for type resolution.

The problems:

- **Renderers replace the entire field in contract.d.ts.** A field with a parameterized renderer emits `readonly payload: AuditPayload` instead of preserving the `ContractField` shape (`{ nullable, type: { kind, codecId, typeParams } }`). Code that expects model fields to conform to `ContractField` breaks.

- **Renderers live in descriptor metadata, not on the codec.** The codec owns every other representation of the type. Descriptor metadata is an indirection that provides no benefit.

- **The SQL emitter overrides `EmissionSpi.generateModelsType?`.** The sole purpose is to inject renderer dispatch and cross-reference model fields against storage columns to derive `codecId` and `typeParams`. After [TML-2206](https://linear.app/prisma-company/issue/TML-2206) (value objects), model fields carry their own `ScalarFieldType` with `codecId` and `typeParams` resolved at contract build time. The storage cross-referencing is redundant; the override duplicates ~110 lines of the framework's 37-line default.

- **No common abstraction.** The emit-time renderer (string output) and the no-emit `parameterizedOutput` (type-level function) serve the same purpose but share no interface.

## Decision

### Codecs own typeParams rendering

An optional `renderTypeParams` method on the `Codec` interface transforms runtime `typeParams` into their type-level representation for emission:

```ts
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  renderTypeParams?(typeParams: Record<string, unknown>): Record<string, unknown> | undefined;
}
```

When absent, the emitter uses default const literal serialization — the runtime values become readonly literal types directly (e.g., `{ length: 1536 }` → `{ readonly length: 1536 }`).

When present, the codec transforms the values. The JSON Schema codec converts a JSON Schema payload into a TypeScript type expression. The emitter serializes the *returned* value, not the original.

The mapping from runtime to type-level values is **codec-controlled**:

- **Most codecs (Vector, Char, Enum, Numeric):** Identity. `{ length: 1536 }` → `{ readonly length: 1536 }`. No `renderTypeParams` needed.

- **JSON Schema (pg/jsonb@1, pg/json@1):** Non-identity. `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }` → `{ outputType: { name: string } }`. The schema is converted to a TypeScript type expression at emission time.

This is a uniform architecture, not a special case. Every parameterized codec uses the same pipeline — `parameterizedOutput` on `CodecTypes` consumes the type-level `typeParams` and resolves the output type. The rendering function is the only variation point.

### `parameterizedOutput` is the single resolution mechanism

Every parameterized codec declares a `parameterizedOutput` function type on `CodecTypes` — a type-level function from type-level `typeParams` to output type:

```ts
// CodecTypes for pg/vector@1:
readonly 'pg/vector@1': {
  readonly output: number[];
  readonly parameterizedOutput: <P extends { readonly length: number }>(
    params: P,
  ) => P extends { readonly length: infer N extends number } ? Vector<N> : Vector<number>;
};
```

This resolves the output type in both paths:

- **Emit path:** The emitter serializes (possibly transformed) `typeParams` as literals in the d.ts. `ComputeColumnJsType` feeds them to `parameterizedOutput`.
- **No-emit path:** The authoring surface captures type-level values directly (e.g., the phantom `schema` key). `parameterizedOutput` resolves them.

### Structural field shape is always preserved

The emitter always emits model fields with the full `ContractField` structure:

```ts
readonly embedding: {
  readonly nullable: false;
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: 'pg/vector@1';
    readonly typeParams: { readonly length: 1536 };
  };
};
```

The rendered `typeParams` (with codec-transformed type-level values where applicable) go *inside* this shape. The renderer never replaces the entire field.

### `EmissionSpi.generateModelsType?` override is removed

This is a hard constraint. After TML-2206, model fields carry resolved `codecId` and `typeParams` at build time. The SQL emitter's override is deleted. The framework emitter's `generateFieldResolvedType` handles all families — SQL, Mongo — and all field contexts — model fields, value object fields, union members.

### Framework emitter owns rendering dispatch

The framework emitter's field generation logic:

1. Reads `ScalarFieldType.typeParams` from the field
2. Looks up the codec via `CodecLookup` (added to the emission pipeline)
3. Calls `codec.renderTypeParams(typeParams)` if present; otherwise uses default serialization
4. Serializes the result as type-level literals in the d.ts

This lives in `@prisma-next/emitter` (tooling layer), dispatching to codecs via `CodecLookup` from the core layer.

### Legacy infrastructure is deleted

| Removed | Location |
|---|---|
| `TypeRenderer` union (4 shapes), `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`, `RenderTypeContext` | `framework-components/src/type-renderers.ts` |
| `TypeRenderEntry`, `ParameterizedCodecDescriptor` | `framework-components/src/emission-types.ts` |
| `extractParameterizedRenderers` | `framework-components/src/control-stack.ts` |
| `parameterizedRenderers` on control stack, `EmitStackInput`, `GenerateContractTypesOptions` | Multiple files |
| `parameterized` maps in descriptor metadata | `adapter-postgres`, `pgvector` |
| `EmissionSpi.generateModelsType?` | `framework-components/src/emission-types.ts` |
| SQL emitter's `generateModelsType` override | `sql-contract-emitter/src/index.ts` |

## Consequences

### Benefits

- **Single owner per representation.** Codecs own all four type representations (wire, JSON, DDL, TypeScript). Finding how a codec's type is rendered means looking at the codec.

- **Structural fields preserved.** Model fields in `contract.d.ts` always conform to `ContractField`. Downstream tooling (type utilities, query system, plugins) can rely on a uniform structure.

- **Family-agnostic emission.** The framework emitter handles all families without overrides. New families get parameterized type support for free.

- **Simpler infrastructure.** Four `TypeRenderer` shapes, a normalization pipeline, descriptor metadata threading, and an `EmissionSpi` override are replaced by one optional method on the codec.

- **Uniform parameterized resolution.** `parameterizedOutput` on `CodecTypes` is the single mechanism for both emit and no-emit paths. Adding a new parameterized codec means: define `renderTypeParams` (if non-identity), declare `parameterizedOutput` on `CodecTypes`.

### Costs

- **`CodecLookup` flows into the emitter.** The emission pipeline gains a dependency on codec instances (not just codec IDs). The control stack already assembles descriptors; assembling a codec lookup is a small addition.

- **JSON Schema rendering stays complex.** Converting a JSON Schema payload to a TypeScript type expression is inherently non-trivial. This ADR moves *where* that logic lives (from descriptor metadata to the codec) but does not simplify the logic itself.

## Alternatives considered

### Keep renderers, move them onto the codec

Put the full `TypeRenderer` (string-producing function) on the codec instead of in descriptor metadata.

Rejected because the renderer replaces the entire field shape, which is the root problem. Moving the same function to a different location doesn't fix the structural issue.

### Emit resolved types directly (no `parameterizedOutput`)

Have `renderTypeParams` produce the final output type string (e.g., `'Vector<1536>'`), stamped directly onto the field's output type in the d.ts. Remove `parameterizedOutput` from `CodecTypes`.

Rejected because this would make the emit and no-emit paths fundamentally different. The no-emit path needs type-level resolution from `typeParams` (since there's no rendering step). Keeping `parameterizedOutput` as the single resolution mechanism means both paths use the same type-level function — the only difference is where the input `typeParams` come from.

### Make `renderTypeParams` required with identity default

Like `encodeJson`/`decodeJson` on [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), make it required with an identity default provided by the `codec()` factory.

Deferred. Most codecs don't have `typeParams` at all, so the method would be vacuously present. Optional with a well-defined default (identity serialization by the emitter) is cleaner for now.

## Supersedes

- **`parameterized` renderer infrastructure** in descriptor metadata — replaced by `renderTypeParams` on the codec.
- **`EmissionSpi.generateModelsType?` override pattern** — replaced by framework-level field rendering with codec dispatch.

## Resolves

- **ADR 185 open concern: `EmissionSpi` complexity.** The `generateModelsType?` override on `EmissionSpi` — the primary source of SPI complexity in the SQL emitter — is removed.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md) — established the pattern of codecs owning their representations
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md) — established `typeParams` on storage columns
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md) — introduced typed JSON columns with Standard Schema
- [ADR 185 — SPI types live at the lowest consuming layer](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — `EmissionSpi` placement and design
- [Design spec: Codec-dispatched type rendering](../../../projects/orm-consolidation/specs/codec-dispatched-type-rendering.md) — detailed implementation spec with worked examples
