# ADR 186 — Codec-dispatched type rendering

## At a glance

A `vector(1536)` column has `typeParams: { length: 1536 }` in the contract. When the emitter generates `contract.d.ts`, that field's output type should be `Vector<1536>`, not the generic `number[]`. The codec — which already owns the wire format, JSON serialization, and DDL rendering for this type — also controls how its type parameters appear at the TypeScript level.

Two examples show how this works — one simple (Vector), one that requires a transformation (JSON Schema).

### Example 1: Vector — identity mapping

A `vector(1536)` column stores `{ length: 1536 }` as its `typeParams` in `contract.json`. The emitter serializes this as a const literal into the d.ts:

```ts
// contract.d.ts — emitted field
readonly embedding: {
  readonly nullable: false;
  readonly codecId: 'pg/vector@1';
  readonly typeParams: { readonly length: 1536 };
};
```

A type-level function on `CodecTypes` — `parameterizedOutput` — resolves the output type from those literals:

```ts
// CodecTypes declaration for pg/vector@1
readonly 'pg/vector@1': {
  readonly output: number[];
  readonly parameterizedOutput: <P extends { readonly length: number }>(
    params: P,
  ) => P extends { readonly length: infer N extends number } ? Vector<N> : number[];
};
```

`ComputeColumnJsType` feeds `{ readonly length: 1536 }` to `parameterizedOutput`, yielding `Vector<1536>`.

The Vector codec needs no special handling — the runtime `typeParams` are already valid as type-level literals. This is the common case.

### Example 2: JSON Schema — codec-controlled transformation

A `jsonb(schema)` column stores `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }` as its `typeParams` in `contract.json`. Serializing this as a const literal would be useless — `parameterizedOutput` can't derive `{ name: string }` from a JSON Schema payload at the type level.

Instead, the codec transforms the `typeParams` at emission time. The runtime JSON Schema is converted into its TypeScript equivalent, and the transformed value is written into the d.ts:

```ts
// contract.json (runtime)                    → contract.d.ts (type-level)
{ schemaJson: { type: 'object', ... } }       → { readonly resolvedType: { name: string } }
```

The emitted field:

```ts
// contract.d.ts — emitted field
readonly payload: {
  readonly nullable: false;
  readonly codecId: 'pg/jsonb@1';
  readonly typeParams: { readonly resolvedType: { name: string } };
};
```

The `parameterizedOutput` for `pg/jsonb@1` extracts the resolved type:

```ts
// CodecTypes declaration for pg/jsonb@1
readonly 'pg/jsonb@1': {
  readonly output: JsonValue;
  readonly parameterizedOutput: <P>(
    params: P,
  ) => P extends { readonly resolvedType: infer T } ? T : JsonValue;
};
```

`ComputeColumnJsType` feeds `{ readonly resolvedType: { name: string } }` to `parameterizedOutput`, yielding `{ name: string }`.

The transformation is implemented by an optional method on the codec:

```ts
const pgJsonbCodec = codec({
  typeId: 'pg/jsonb@1',
  targetTypes: ['jsonb'],
  encode: (value): string => JSON.stringify(value),
  decode: (wire): JsonValue => typeof wire === 'string' ? JSON.parse(wire) : wire,
  emitTypeParams(typeParams) {
    const schemaJson = typeParams['schemaJson'];
    if (schemaJson && typeof schemaJson === 'object') {
      return { resolvedType: renderTypeFromJsonSchema(schemaJson) };
    }
    return undefined; // fall back to default serialization
  },
});
```

### The type-level `typeParams` may differ from the runtime value

The `typeParams` in `contract.d.ts` is a **type-level representation** — it carries the values that `parameterizedOutput` needs to resolve the output type. For most codecs, these are identical to the runtime values in `contract.json`. For JSON Schema, they're different: the runtime value is a JSON Schema payload; the type-level value is the resolved TypeScript type.

This is intentional. The d.ts is a type artifact — its purpose is to provide correct TypeScript types for the query system, not to mirror the JSON byte-for-byte. If you need the runtime `typeParams`, read `contract.json`. The d.ts exists to make `ComputeColumnJsType` produce the right output.

## Two representations, one resolution mechanism

A parameterized codec's output type depends on its type parameters. These parameters exist in two parallel forms:

1. **Runtime values** — the concrete data in `contract.json`. For Vector: `{ length: 1536 }`. For typed JSON: `{ schemaJson: { ... } }`.

2. **Type-level values** — what appears in `contract.d.ts`. These are what `parameterizedOutput` on `CodecTypes` consumes to compute the output type.

The mapping from runtime to type-level values is **codec-controlled** via the optional `emitTypeParams` method:

- **Most codecs:** Identity. No `emitTypeParams` needed — the emitter serializes the runtime values as const literals directly.
- **JSON Schema:** A transformation. `emitTypeParams` converts the runtime JSON Schema into a TypeScript type that `parameterizedOutput` can extract.

This is a uniform architecture, not a special case. Every parameterized codec uses `parameterizedOutput` on `CodecTypes`. The only variation is whether the codec transforms its `typeParams` before they're written into the d.ts.

This unifies the two workflows the system supports:

- **Emit workflow:** The emitter generates `contract.d.ts` from the contract JSON. The (possibly transformed) `typeParams` appear as literal types in the d.ts, and `parameterizedOutput` resolves the output type.
- **No-emit workflow:** The developer constructs a contract programmatically in TypeScript. Type-level values are captured directly by the authoring surface (e.g., a phantom type key carries the Arktype schema's TypeScript type). The same `parameterizedOutput` resolves the output type — no rendering step needed.

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

### `emitTypeParams` on the Codec interface

An optional method transforms runtime `typeParams` into the type-level representation that gets written into `contract.d.ts`:

```ts
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  emitTypeParams?(typeParams: Record<string, unknown>): Record<string, unknown> | undefined;
}
```

When absent, the emitter serializes the runtime `typeParams` as const literals (identity mapping — the common case). When present, the codec transforms the values — the emitter writes the *returned* value into the d.ts, not the original. Returning `undefined` falls back to the default.

### `parameterizedOutput` is the single type resolution mechanism

Every parameterized codec declares a `parameterizedOutput` function type on `CodecTypes` — a type-level function from the d.ts `typeParams` to the codec's output type (see the Vector and JSONB examples above). This resolves the output type in both the emit path (from literals in the d.ts) and the no-emit path (from type-level values captured by the authoring surface). One mechanism, not two.

### Structural field shape is always preserved

The emitter always emits model fields with the full `ContractField` structure. The type-level `typeParams` go *inside* the field shape. The renderer never replaces the entire field.

### `EmissionSpi.generateModelsType?` override is removed

This is a hard constraint. After TML-2206, model fields are self-contained — they carry resolved `codecId` and `typeParams` at build time, so the SQL emitter no longer needs to cross-reference storage columns. The framework emitter's `generateFieldResolvedType` handles all families (SQL, Mongo) and all field contexts (model fields, value object fields, union members).

### The framework emitter owns rendering dispatch

The framework emitter's field generation:

1. Reads `ScalarFieldType.typeParams` from the field
2. Looks up the codec via `CodecLookup` (added to the emission pipeline)
3. Calls `codec.emitTypeParams(typeParams)` if present; otherwise uses default serialization
4. Serializes the result as type-level literals in the d.ts

This lives in `@prisma-next/emitter` (tooling layer), dispatching to codecs via `CodecLookup` from the core layer. The legacy renderer infrastructure — `TypeRenderer`, normalization pipeline, `parameterizedRenderers` threading through the control stack, and `parameterized` maps in descriptor metadata — is deleted.

## Consequences

### Benefits

- **Single owner per representation.** Codecs own all four type representations (wire, JSON, DDL, TypeScript). Finding how a codec's type is rendered means looking at the codec.

- **Structural fields preserved.** Model fields in `contract.d.ts` always conform to `ContractField`. Downstream tooling can rely on a uniform structure.

- **Family-agnostic emission.** The framework emitter handles all families without overrides. New families get parameterized type support for free.

- **Simpler infrastructure.** Four `TypeRenderer` input shapes, a normalization pipeline, descriptor metadata threading, and an `EmissionSpi` override are replaced by one optional method on the codec.

- **Uniform parameterized resolution.** Adding a new parameterized codec means: declare `parameterizedOutput` on `CodecTypes`, optionally define `emitTypeParams` (if non-identity). Both paths work automatically.

### Costs

- **`CodecLookup` flows into the emitter.** The emission pipeline gains a dependency on codec instances (not just codec IDs). The control stack already assembles descriptors; assembling a codec lookup is a small addition.

- **JSON Schema rendering stays complex.** Converting a JSON Schema payload to a TypeScript type expression is inherently non-trivial. This ADR moves *where* that logic lives (from descriptor metadata to the codec) but does not simplify the logic itself.

## Alternatives considered

### Keep renderers, move them onto the codec

Put the full `TypeRenderer` (string-producing function) on the codec instead of in descriptor metadata.

Rejected because the renderer replaces the entire field shape, which is the root problem. Moving the same function to a different location doesn't fix the structural issue.

### Emit resolved types directly (no `parameterizedOutput`)

Have `emitTypeParams` produce the final output type string (e.g., `'Vector<1536>'`), stamped directly onto the field's output type in the d.ts. Remove `parameterizedOutput` from `CodecTypes`.

Rejected because this would make the emit and no-emit paths fundamentally different. The no-emit path needs type-level resolution from `typeParams` (since there's no rendering step). Keeping `parameterizedOutput` as the single resolution mechanism means both paths use the same type-level function — the only difference is where the input `typeParams` come from.

### Make `emitTypeParams` required with identity default

Like `encodeJson`/`decodeJson` on [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), make it required with an identity default provided by the `codec()` factory.

Deferred. Most codecs don't have `typeParams` at all, so the method would be vacuously present. Optional with a well-defined default (identity serialization by the emitter) is cleaner for now.

## Supersedes

- **`parameterized` renderer infrastructure** in descriptor metadata — replaced by `emitTypeParams` on the codec.
- **`EmissionSpi.generateModelsType?` override pattern** — replaced by framework-level field rendering with codec dispatch.

## Resolves

- **ADR 185 open concern: `EmissionSpi` complexity.** The `generateModelsType?` override on `EmissionSpi` — the primary source of SPI complexity in the SQL emitter — is removed.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md) — established the pattern of codecs owning their representations
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md) — established `typeParams` on storage columns
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md) — introduced typed JSON columns with Standard Schema
- [ADR 185 — SPI types live at the lowest consuming layer](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — `EmissionSpi` placement and design
- [Design spec: Codec-dispatched type rendering](../../../projects/orm-consolidation/specs/codec-dispatched-type-rendering.md) — detailed implementation spec with worked examples
