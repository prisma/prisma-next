# ADR 205 — Higher-order codecs for parameterized types

## Context

[ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) gave codecs ownership of how their TypeScript output type renders into `contract.d.ts`. The renderer (`renderOutputType`) lived as an optional method on the codec object, alongside `encode` / `decode` / `encodeJson` / `decodeJson`. The decision left one path explicitly deferred: the **no-emit workflow** (a developer importing `defineContract(...)` without ever running `pnpm emit`) still resolved a `vector(1536)` column to `number[]` and a JSON-with-schema column to `JsonValue`. The fix needed a separate design pass — TML-2229.

The same pre-M5 layout had three other shapes that didn't fit the "codec is one artifact per type" story:

- A parameterized codec's runtime parameters (`paramsSchema`) lived on the codec, but they aren't a runtime conversion concern; they are framework-side validation of JSON-sourced configuration.
- An optional `init(params)` hook on the codec materialized per-instance state (e.g. compiled JSON-Schema validators) when the runtime first saw a `storage.types` entry. The hook had the same signature, the same lifecycle, and the same purpose as the curried factory function pack authors already wrote — duplicated, not unified.
- The `renderOutputType` hook (added by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) ran on the JSON `typeParams` payload, ahead of any runtime codec instance. Like `paramsSchema`, it is framework-facing metadata, not a wire conversion.

The pack-author surface compounded the problem: every parameterized codec shipped a hand-rolled `vectorColumn(N)` / `charColumn(N)` / `numericColumn(p, s)` factory whose return type was the generic `ColumnTypeDescriptor`. The dimension or precision propagated into `contract.json` but vanished from the TypeScript type the no-emit resolver could see. Every column-author shipped one factory at the value level and one renderer at the descriptor level, and the two could drift.

[ADR 204](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) addressed the analogous problem on the operations side: a declarative argument-spec record was replaced by an authored TypeScript function whose signature is the type-level surface and whose body is the runtime. The function is the only behavior-bearing artifact; a small descriptor (`SqlOperationDescriptor`) carries the dispatch hint that doesn't belong inside the function. We apply the same pattern to parameterized codecs here.

## Decision

A parameterized codec is a **higher-order codec** (HoC): a curried TypeScript function `(params) => (ctx: Ctx) => Codec<…, Js>`. The function's signature is the type-level surface; its body is the runtime. A small sister descriptor — `ParameterizedCodecDescriptor<P>` — registers the function with the framework and carries the JSON-side metadata (`paramsSchema`, optional `renderOutputType`).

```ts
// `Ctx` lives in `@prisma-next/framework-components/codec` next to the base `Codec` type.
export interface Ctx {
  readonly name: string;                  // storage.types instance name
  readonly usedAt: ReadonlyArray<{
    readonly table: string;
    readonly column: string;
  }>;
}

export interface ParameterizedCodecDescriptor<P = Record<string, unknown>> {
  readonly codecId: string;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

Pack authors export both:

```ts
// Pack-author surface — what users write.
export function vector<N extends number>(
  length: N,
): (ctx: Ctx) => Codec<'pg/vector@1', readonly ['equality'], string, Vector<N>> { … }

// Framework-registration surface — what the runtime registry consumes.
export const pgVectorCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vector(length),
};
```

In the column-author DSL the user writes `field.column(vector(1536))`. The contract-authoring builder threads the descriptor's data part (`codecId`, `nativeType`, `typeParams`) into the contract IR exactly as before; the curried factory is stored on `ColumnTypeDescriptor.type` as a first-class slot for the no-emit `FieldOutputType` resolver to read off.

The base `Codec` interface (in `@prisma-next/framework-components`) is **unchanged**. The transitional `paramsSchema?` / `init?` / `renderOutputType?` slots on the SQL `Codec` and Mongo `MongoCodec` extensions are removed; the equivalents live on `ParameterizedCodecDescriptor` (paramsSchema, renderOutputType) and inside the factory closure (init's intent).

### Design principles

1. **The function is the signature.** Type-level resolution and runtime instantiation are a single artifact. There is no separate type-level brand, no HKT, no parallel `OutputType` field, no `init` hook. Drift between a declarative record and a matching runtime function is impossible because there is no declarative record.
2. **Descriptor metadata is the minimum.** `ParameterizedCodecDescriptor` carries `codecId`, `paramsSchema`, optional `renderOutputType`, and the curried `factory`. Everything else lives inside the factory closure or on the `Codec` it returns.
3. **`Ctx` is the framework's input to the factory.** Pack authors never construct it; the contract-authoring builder synthesizes it at column-evaluation time and the runtime synthesizes it at contract-load time. `usedAt` is plural so a `storage.types` entry shared across multiple columns can derive shared per-instance state from the aggregated set.
4. **`paramsSchema` is the JSON boundary.** It validates `typeParams` arriving from a serialized contract (PSL parse, `contract.json` load) before the framework hands them to the factory. Pack authors don't validate inside the factory body; the descriptor does it once, at the boundary.
5. **`renderOutputType` is the emit boundary.** When the emitter walks a parameterized column, it reads the descriptor's `renderOutputType` to render the column's TypeScript type into `contract.d.ts`. The codec object itself carries no rendering concern.
6. **Surface segregation, not dynamic dispatch.** Where a single codec id needs different representations on different surfaces (the live-schema-typed `json(productSchema)` factory for column authors vs. the legacy serialized-typeParams renderer for the emitter), each surface registers its own descriptor through its own framework slot. There is no runtime selection between descriptors.

## How it works

### Column authoring

A user writes:

```ts
import { vector } from '@prisma-next/extension-pgvector/column-types';

const Document = model('Document', {
  fields: {
    embedding: field.column(vector(1536)),
  },
});
```

`vector(1536)` returns a `ColumnTypeDescriptor` carrying both:

- The data part the contract IR consumes — `codecId: 'pg/vector@1'`, `nativeType: 'vector'`, `typeParams: { length: 1536 }`.
- A `type: (ctx: Ctx) => Codec<…, Vector<1536>>` slot — the curried factory itself, threaded onto the descriptor for the no-emit `FieldOutputType` resolver.

The contract-authoring builder reads the data part into the contract IR unchanged. The `type` slot stays on the authoring-time `ModelStorageColumn` for the resolver; it is never serialized to `contract.json`.

### No-emit type resolution

The no-emit `FieldOutputType<Definition, Model, Field>` follows `typeRef` through `storage.types` first, then asks: does the column carry a `type: (ctx: Ctx) => Codec<…, Js>` factory? If so, it synthetically applies a `Ctx`-shaped value at the type level and reads `Js` off the result. If not (the column was authored with a non-parameterized descriptor), it falls through to the codec's base output type via `CodecTypes[codecId]['output']`.

```ts
// Conceptual shape — implementation lives in @prisma-next/sql-contract-ts.
type FieldOutputType<Def, M extends keyof Def['models'], F extends keyof Def['models'][M]['fields']> =
  ResolveTypeRef<Def, Def['models'][M]['fields'][F]> extends { type: infer Factory }
    ? Factory extends (ctx: Ctx) => Codec<string, readonly CodecTrait[], unknown, infer Js>
      ? ApplyNullable<Def['models'][M]['fields'][F], Js>
      : Fallback<Def, M, F>
    : Fallback<Def, M, F>;
```

Nullability is preserved uniformly (`Js | null` for `nullable: true`).

### Emit-path rendering

The emitter walks the contract IR's models and, for each scalar field, looks up `parameterizedCodecLookup.get(field.type.codecId)`. If the descriptor has `renderOutputType`, the emitter calls it with the field's serialized `typeParams` and stamps the result into `FieldOutputTypes[Model][Field]`. If the descriptor isn't found or `renderOutputType` is absent, the emitter falls through to `CodecTypes[codecId]['output']` (the codec's base output type from the codec-types map).

The `parameterizedCodecLookup` is assembled by `extractParameterizedCodecLookup` in `@prisma-next/framework-components/control` from each component's `types.codecTypes.parameterizedCodecs` contribution.

### Runtime materialization

When the runtime loads `contract.json`, `sql-runtime`'s `initializeTypeHelpers` walks `storage.types` (named instances) and every column with inline `typeParams` (anonymous instances). For each:

1. Look up the descriptor by `codecId`.
2. Validate `typeParams` via `descriptor.paramsSchema['~standard'].validate(typeParams)` — the JSON-boundary validation.
3. Call `descriptor.factory(validatedParams)({ name, usedAt })` once. `name` is the storage-type name (or `<anon:${table}.${column}>` for an inline `typeParams` column); `usedAt` aggregates every column referencing the instance.
4. Index the resulting `Codec` by instance name. Per-column dispatch resolves through this index; the factory closure carries any per-instance state.

For codecs whose runtime needs per-instance helper state (e.g. compiled JSON-Schema validators), the resolved `Codec` carries the helper as a field; the framework gates the read on the `'json-validator'` `CodecTrait` so the cast to a typed `JsonValidatorCodec` view is structurally safe.

The runtime materialization runs the same factory the column author wrote at authoring time, with parameters round-tripped through the contract JSON. There is no parallel runtime function and no opportunity for drift.

## Consequences

### Positive

- **One artifact per parameterized type.** Pack authors write one curried factory function. Its TypeScript signature is what the no-emit resolver reads; its body is what the runtime invokes. The descriptor's `renderOutputType` is the only piece the framework "owns" separately, and only because the emit path runs without the factory in scope.
- **The base `Codec` interface is parameterization-free.** Non-parameterized codecs (text, int, bool) carry no slots they don't use; parameterized codecs (vector, char, json) carry the same `encode` / `decode` / `encodeJson` / `decodeJson` shape with no extra fields. The two stop diverging.
- **No-emit columns infer correctly.** `vector(1536)` resolves to `Vector<1536>` (literal `N` preserved through curried application); `json(productSchema)` resolves to `StandardSchemaV1.InferOutput<typeof productSchema>`; `cipherStashText({ keyId })` resolves to `string` even though the wire is ciphertext.
- **Forward-compat for column-scoped codecs.** Stateful codecs (CipherStash, future per-instance encoders) author against `(params, ctx)` today. The contract-load runtime materialization is currently a documented contract; closing it under TML-2330 ships behind the same surface pack authors already adopted.
- **Surface segregation generalises.** When a codec id needs distinct representations on different surfaces — e.g. a schema-typed factory for column authors and a serialized-typeParams renderer for the emit path on the same `pg/json@1` codec id — each surface registers an independent descriptor through its own framework slot. The TML-2330 follow-up unifies these slots; surface segregation is a clean transitional state in the meantime.

### Trade-offs

- **`ColumnTypeDescriptor` grew a `type` slot.** The optional `type?: (ctx: Ctx) => Codec` field is the price of letting the no-emit resolver read the factory's return type without reaching into the runtime codec registry. The slot is structurally optional and ignored by the IR serializer.
- **Two descriptors per codec id are possible.** The schema-typed `pgJsonCodec` and the legacy-typeParams `pgJsonLegacyCodec` both register against `pg/json@1` (one from `exports/codecs.ts`, one from `exports/control.ts`) because the IR's serialized `typeParams` shape (`{ schemaJson, type? }`) cannot reconstitute a live Standard Schema. TML-2330 collapses the IR shape so a single descriptor covers both surfaces.
- **Mongo lacks a control-plane parameterized-codecs slot today.** The Mongo control descriptor doesn't carry the slot; the Mongo `vector(N)` factory is exported and tested but cannot register through control until the slot lands. Mongo demos don't use vectors, so the gap is an authoring-time surface gap rather than a runtime regression.

## Alternatives considered

### Type-level brand or `OutputType` HKT field on the codec

The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>` in the no-emit path. Rejected because the same information already lives in the factory function's TypeScript return type — encoding it twice and synchronizing the two encodings via `renderOutputType` is exactly the drift `function-as-signature` is meant to prevent.

### Optional `init(params, instance)` hook on the codec

Codec carries `init?` separately from the factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — the same signature, the same lifecycle, the same purpose. One artifact, not two.

### Shared `columnFor(codec)(params)` helper

A single `columnFor` helper turns any codec into a column-descriptor factory, type-discriminated on whether the codec is parameterized. Rejected because each pack ships a typed factory directly — `columnFor` adds no type information and adds an indirection at the call site.

### Global declaration-merged `CodecOutputTypes` interface

Each codec augments a global registry; `FieldOutputType` reads the JS type from the merged registry. Rejected for ambient global pollution, order-dependent merging, and identity brittleness across two contracts in one program.

### Compute output type from the codec's `output` type alone

A "smart" `FieldOutputType` narrows the codec's `output` (e.g. `number[]`) using `typeParams`. Rejected: there is no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is what the factory's return type does. Doesn't generalize to JSON-with-schema.

## Supersedes

- The transitional **`paramsSchema?` field on the SQL `Codec` extension** (replaced by `ParameterizedCodecDescriptor.paramsSchema`).
- The transitional **`init?` hook on the SQL `Codec` extension** (intent absorbed into the factory closure).
- The **`renderOutputType?` field on the SQL `Codec` and Mongo `MongoCodec` extensions** introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) (moves to `ParameterizedCodecDescriptor.renderOutputType`).
- The pre-existing pack-author column-descriptor factories (`vectorColumn`, `charColumn`, `numericColumn`, etc. as descriptor-returning helpers) are reshaped to return `ColumnTypeDescriptor & { type: (ctx) => Codec<…> }`. The user-call site (`field.column(vector(1536))`) is unchanged.

## Resolves

- **TML-2229.** `vector(1536)` and `json(schema)` resolve correctly in the no-emit path.
- **ADR 186 deferred no-emit fix.** The `renderOutputType` it introduced moves to its long-term home on the descriptor; the no-emit path resolves through the factory's return type.

## Related

- [ADR 186 — Codec-dispatched type rendering](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) — established codec ownership of TypeScript output rendering; deferred the no-emit fix this ADR closes.
- [ADR 204 — Operations as TypeScript functions](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) — the "function is the signature" precedent applied here.
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md) — established the pattern of codecs owning their representations.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md) — established `typeParams` on storage columns.
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md) — introduced typed JSON columns with Standard Schema.
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md) — the trait system gating per-instance helper extraction (`'json-validator'`).

## Open questions

- **TML-2330** will collapse the descriptor surfaces. Today the column-author surface (`pgJsonCodec`), the emit-path surface (`pgJsonLegacyCodec`), and the runtime-load surface (`pgJsonRuntimeFactory`) coexist for the same `pg/json@1` codec id because the IR's serialized `typeParams` shape (`{ schemaJson, type? }`) can't reconstitute a live Standard Schema. Collapsing the IR shape so a single descriptor handles all three surfaces is the next step.
- **Mongo control-plane parameterized-codecs slot.** Adding the slot to the Mongo control descriptor lets Mongo's `vector(N)` register the same way Postgres parameterized codecs do. Surgical change, not in this ADR's scope.
