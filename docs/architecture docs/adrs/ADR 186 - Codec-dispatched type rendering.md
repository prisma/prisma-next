# ADR 186 — Codec-dispatched type rendering

## At a glance

A `vector(1536)` column has `typeParams: { length: 1536 }` in the contract. When the emitter generates `contract.d.ts`, that field's output type should be `Vector<1536>`, not the generic `number[]`. The codec — which already owns the wire format, JSON serialization, and DDL rendering for this type — also controls how its type parameters appear at the TypeScript level.

Here's what the emitted `contract.d.ts` looks like for that field:

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

The field preserves the full structural `ContractField` shape. The `typeParams` are serialized as TypeScript literal types. A single type-level function on `CodecTypes` — `parameterizedOutput` — resolves the output type from those literals: `{ readonly length: 1536 }` → `Vector<1536>`.

Most codecs need nothing special — the emitter serializes their runtime `typeParams` as const literals by default. Codecs that need a different type-level representation (like JSON Schema, where a runtime JSON Schema payload becomes a TypeScript object type) provide one optional method:

```ts
const pgJsonbCodec = codec({
  typeId: 'pg/jsonb@1',
  targetTypes: ['jsonb'],
  encode: (value): string => JSON.stringify(value),
  decode: (wire): JsonValue => typeof wire === 'string' ? JSON.parse(wire) : wire,
  renderTypeParams(typeParams) {
    const schemaJson = typeParams['schemaJson'];
    if (schemaJson && typeof schemaJson === 'object') {
      return { outputType: renderTypeFromJsonSchema(schemaJson) };
    }
    return undefined; // fall back to default serialization
  },
});
```

## Two representations of the same data

A parameterized codec's output type depends on its type parameters. These parameters exist in two parallel forms:

1. **Runtime values** — the concrete data in `contract.json`. For a vector column: `{ length: 1536 }`. For a typed JSON column: `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }`.

2. **Type-level values** — what appears in `contract.d.ts` as TypeScript literal types. These are what the `parameterizedOutput` function on `CodecTypes` consumes to compute the output type.

The mapping from runtime values to type-level values is **codec-controlled**:

- **Most codecs (Vector, Char, Enum, Numeric):** Identity. The runtime value `{ length: 1536 }` is serialized directly as `{ readonly length: 1536 }`. The `parameterizedOutput` type computes the result: `Vector<1536>`.

- **JSON Schema (pg/jsonb@1, pg/json@1):** A transformation. The runtime value `{ schemaJson: { ... JSON Schema ... } }` is converted at emission time into `{ outputType: { name: string; age: number } }` — the TypeScript type that the schema describes. The `parameterizedOutput` type simply extracts it.

This is the same architecture in both cases. Every parameterized codec uses `parameterizedOutput` on `CodecTypes`. The only variation is whether the codec transforms its `typeParams` before they're written into the d.ts, or lets the emitter serialize them as-is.

This also unifies the two workflows the system supports:

- **Emit workflow:** The emitter generates `contract.d.ts` from the contract JSON. The (possibly transformed) `typeParams` appear as literal types in the d.ts, and `parameterizedOutput` resolves the output type.
- **No-emit workflow:** The developer constructs a contract programmatically in TypeScript. Type-level values are captured directly by the authoring surface (e.g., a phantom type key carries the schema's TypeScript type). The same `parameterizedOutput` resolves the output type — no rendering step needed.

One mechanism, two entry points.

## Context

Codecs already own three of the four representations of a type:

| Representation | Owner | Method |
|---|---|---|
| Wire format (driver ↔ database) | Codec | `encode` / `decode` |
| Contract JSON (serialized values) | Codec | `encodeJson` / `decodeJson` ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md)) |
| DDL string (migration SQL) | Target-layer codec hook | `expandNativeType` ([ADR 171](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md)) |
| **TypeScript type in contract.d.ts** | **Scattered** | See below |

The fourth representation — the TypeScript output type in `contract.d.ts` — is currently spread across three systems: a `CodecTypes` type map (handles non-parameterized codecs), a `parameterized` renderer map in descriptor metadata (produces type expression strings at emit time), and a `parameterizedOutput` function type on `CodecTypes` (handles the no-emit path). These systems don't share an interface or abstraction.

The problems this causes:

- **Renderers replace the entire field in contract.d.ts.** When a parameterized renderer fires, it emits `readonly payload: AuditPayload` — a raw type expression — instead of preserving the structural `ContractField` shape. Code that expects model fields to have `{ nullable, type: { kind, codecId, typeParams } }` breaks.

- **Renderers are registered in descriptor metadata, not on the codec.** The codec owns every other representation of the type. Type rendering is an outlier.

- **The SQL emitter overrides `EmissionSpi.generateModelsType?` to inject renderer dispatch.** It also cross-references model fields against storage columns to derive `codecId` and `typeParams` — but after TML-2206 (value objects & embedded documents), model fields carry their own `ScalarFieldType` with `codecId` and `typeParams` resolved at contract build time. The storage cross-referencing is redundant. The override duplicates ~110 lines of the framework's 37-line default and couples the SQL emitter to storage internals.

## Decision

### `renderTypeParams` on the Codec interface

An optional method transforms runtime `typeParams` into their type-level representation for emission:

```ts
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  renderTypeParams?(typeParams: Record<string, unknown>): Record<string, unknown> | undefined;
}
```

When absent, the emitter uses default const literal serialization. When present, the codec transforms the values — the emitter serializes the *returned* value, not the original.

### `parameterizedOutput` is the single type resolution mechanism

Every parameterized codec declares a `parameterizedOutput` function type on `CodecTypes`:

```ts
readonly 'pg/vector@1': {
  readonly output: number[];
  readonly parameterizedOutput: <P extends { readonly length: number }>(
    params: P,
  ) => P extends { readonly length: infer N extends number } ? Vector<N> : Vector<number>;
};
```

This resolves the output type in both the emit path (from serialized literals in the d.ts) and the no-emit path (from type-level values captured by the authoring surface). One mechanism, not two.

### Structural field shape is always preserved

The emitter always emits model fields with the full `ContractField` structure. The rendered `typeParams` go *inside* the field shape. The renderer never replaces the entire field.

### `EmissionSpi.generateModelsType?` override is removed

This is a hard constraint. After TML-2206, model fields are self-contained — they carry resolved `codecId` and `typeParams` at build time, so the SQL emitter no longer needs to cross-reference storage columns. The framework emitter's `generateFieldResolvedType` handles all families (SQL, Mongo) and all field contexts (model fields, value object fields, union members).

### The framework emitter owns rendering dispatch

The framework emitter's field generation:

1. Reads `ScalarFieldType.typeParams` from the field
2. Looks up the codec via `CodecLookup` (added to the emission pipeline)
3. Calls `codec.renderTypeParams(typeParams)` if present; otherwise uses default serialization
4. Serializes the result as type-level literals in the d.ts

This lives in `@prisma-next/emitter` (tooling layer), dispatching to codecs via `CodecLookup` from the core layer. The legacy renderer infrastructure — `TypeRenderer`, normalization pipeline, `parameterizedRenderers` threading through the control stack, and `parameterized` maps in descriptor metadata — is deleted.

## Consequences

### Benefits

- **Single owner per representation.** Codecs own all four type representations (wire, JSON, DDL, TypeScript). Finding how a codec's type is rendered means looking at the codec.

- **Structural fields preserved.** Model fields in `contract.d.ts` always conform to `ContractField`. Downstream tooling can rely on a uniform structure.

- **Family-agnostic emission.** The framework emitter handles all families without overrides. New families get parameterized type support for free.

- **Simpler infrastructure.** Four `TypeRenderer` input shapes, a normalization pipeline, descriptor metadata threading, and an `EmissionSpi` override are replaced by one optional method on the codec.

- **Uniform parameterized resolution.** Adding a new parameterized codec means: declare `parameterizedOutput` on `CodecTypes`, optionally define `renderTypeParams` (if non-identity). Both paths work automatically.

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
