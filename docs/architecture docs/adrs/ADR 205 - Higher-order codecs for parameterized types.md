# ADR 205 — Higher-order codecs for parameterized types

## At a glance

A user authors one line of TypeScript:

```ts
import { vector } from '@prisma-next/extension-pgvector/column-types';

const Document = model('Document', {
  fields: {
    embedding: field.column(vector(1536)).nullable(),
  },
});
```

Three surfaces resolve from that single function call:

- The TypeScript view of `Document.embedding` is `Vector<1536> | null` — the literal `1536` is preserved, not widened to `number`.
- `pnpm emit` writes the same type into `contract.d.ts`.
- At runtime, decoding the wire form `'[1.2, 3.4, …]'` produces a value the type system already named `Vector<1536>`.

Before this ADR, the no-emit TypeScript type was `number[]` — the dimension vanished between authoring and the type checker. This ADR unifies the four code paths that touch a parameterized column (authoring, type checking, emitting, runtime decoding) under a single artifact, so the user's `vector(1536)` is *the* source of truth for all of them.

## Decision

A **parameterized codec** is a curried function plus a sister registration descriptor:

```ts
// Pack-author surface — what users import and call.
function vector<N extends number>(length: N) {
  return (ctx: Ctx): Codec<'pg/vector@1', readonly ['equality'], string, Vector<N>> => ({
    id: 'pg/vector@1',
    targetTypes: ['vector'],
    traits: ['equality'] as const,
    encode: (v) => `[${v.join(',')}]`,
    decode: (w) => parseVector(w),
    encodeJson: (v) => v as JsonValue,
    decodeJson: (j) => j as Vector<N>,
    meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
  });
}

// Framework-registration surface — what the runtime registry consumes.
const pgVectorCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vector(length),
};
```

The **function** (`vector`) is the only behavior-bearing artifact. Its TypeScript signature is what every type-level surface reads; its body is what the runtime invokes. The **descriptor** (`pgVectorCodec`) registers the function with the framework and carries metadata the framework consults when the function isn't in scope (validating JSON-sourced params at the contract boundary, rendering an output-type string into `contract.d.ts`).

`Ctx` is a small framework-supplied input the curried factory closes over:

```ts
export interface Ctx {
  readonly name: string;
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}
```

Pack authors never construct it. The contract-authoring builder synthesizes it at column-evaluation time; the runtime synthesizes it at contract-load time. `usedAt` is plural so a `storage.types` entry shared across multiple columns can derive shared per-instance state from the aggregated set (e.g. a CipherStash codec deriving one column-scoped key for every column referencing the entry).

Together they replace three optional fields on the prior codec interface (`paramsSchema?`, `init?`, `renderOutputType?`) and the per-codec hand-rolled column helpers (`vectorColumn`, `charColumn`, `numericColumn`, …). The base `Codec` interface ends up parameterization-free.

## How it composes

The same `vector(1536)` participates in four code paths. Each reads a different aspect of the same artifact — never a parallel one.

### 1. Column authoring

`vector(1536)` returns a `ColumnTypeDescriptor` carrying both the data the contract IR needs (`codecId: 'pg/vector@1'`, `nativeType: 'vector'`, `typeParams: { length: 1536 }`) and the curried factory itself, threaded through a first-class `type: (ctx: Ctx) => Codec<…>` slot. The contract-authoring builder consumes the data part for the IR; the `type` slot is authoring-time only and is never serialized to `contract.json`.

### 2. No-emit type resolution

`@prisma-next/sql-contract-ts`'s `FieldOutputType<Definition, Model, Field>` follows `typeRef` through `storage.types`, then synthetically applies `Ctx` to the column's `type` slot at the type level and reads the `Js` parameter off the resulting `Codec<…, Js>`:

```ts
type FieldOutputType<Def, M, F> =
  ResolveTypeRef<Def, Def['models'][M]['fields'][F]> extends { type: infer Factory }
    ? Factory extends (ctx: Ctx) => Codec<string, readonly CodecTrait[], unknown, infer Js>
      ? ApplyNullable<Def['models'][M]['fields'][F], Js>
      : Fallback<Def, M, F>
    : Fallback<Def, M, F>;
```

For `vector(1536)`, this produces `Vector<1536>` (literal `N` preserved through curried application). For non-parameterized columns (no `type` slot), it falls back to `CodecTypes[codecId]['output']`. Nullability is reattached uniformly.

### 3. Emit-path rendering

`pnpm emit` walks the contract IR's models. For each scalar field, it looks up the descriptor by `codecId` in a `parameterizedCodecLookup` (assembled from each component's contribution) and calls `descriptor.renderOutputType(typeParams)`. The result is stamped into `FieldOutputTypes[Model][Field]` in `contract.d.ts`. If the descriptor is absent or has no renderer, the emitter falls through to the codec's base output type.

The emitter never reaches into the runtime codec object. The descriptor is the sole emit-path source of truth.

### 4. Runtime materialization

When `contract.json` loads, `sql-runtime`'s `initializeTypeHelpers` walks `storage.types` (named instances) and every column with inline `typeParams` (anonymous instances, named `<anon:${table}.${column}>`). For each instance:

1. Look up the descriptor by `codecId`.
2. Validate `typeParams` via `descriptor.paramsSchema['~standard'].validate(typeParams)` — the JSON-boundary validation that catches malformed contracts before any factory runs.
3. Aggregate every column referencing this instance into `usedAt`.
4. Call `descriptor.factory(validatedParams)({ name, usedAt })` once, index the resulting `Codec` by instance name.

Per-column dispatch resolves through this index. The factory closure carries any per-instance state the runtime needs (e.g. a compiled JSON-Schema validator); the framework gates the read on a `CodecTrait` marker (`'json-validator'`) so the cast to a typed view is structurally safe.

The same factory the column author wrote at authoring time runs at contract-load time, with parameters round-tripped through the contract JSON. There is no parallel runtime function and no opportunity for drift.

## Why this shape

Two pre-existing problems shaped the design:

**The no-emit TypeScript type didn't reflect parameterization.** Importing a contract definition without running `pnpm emit` was the fast path for iteration. But the type-level resolver `FieldOutputTypes<Definition>` ignored `typeParams`, so `vector(1536)` resolved to `number[]` and `json(productSchema)` resolved to `JsonValue`. Authors who relied on no-emit during development would only discover the precise type after a full emit step (TML-2229).

**Parameterization had been bolted onto the codec interface.** The codec carried `paramsSchema?` for runtime params validation, `init?` for materializing per-instance state, and `renderOutputType?` (added by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) for the emit path. None of these are wire-conversion concerns — they're framework-side metadata that just happened to share a record with `encode` / `decode`. Each parameterized codec also shipped a hand-rolled column-descriptor factory (`vectorColumn(N)`, `charColumn(N)`, …) whose return type collapsed to a generic `ColumnTypeDescriptor`. The function knew the shape of the output type; the codec didn't; the renderer encoded the relationship a third time. Three places to keep in sync, each owned by a different artifact.

Both problems share a root cause: the type-level facts about a parameterized column lived in three places (the column-helper factory, the codec record, the renderer) with no single source of truth.

[ADR 204](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) had already faced the analogous problem on the operations side: a declarative argument-spec record was replaced by a TypeScript function whose signature was the type-level surface and whose body was the runtime. We apply that pattern here. The function the column author writes is the function the runtime invokes is the function whose return type the no-emit resolver reads. Drift between a declarative record and a matching runtime function is impossible because there is no declarative record.

## Consequences

### What works better

- **One artifact per parameterized type.** The pack author writes one curried factory function. The descriptor's `renderOutputType` is the only piece the framework owns separately, and only because the emit path runs without the factory in scope.
- **Type fidelity end-to-end.** `vector(1536)` resolves to `Vector<1536>` at authoring time, in the no-emit path, in the emitted `contract.d.ts`, and at runtime decode. `json(productSchema)` resolves to `StandardSchemaV1.InferOutput<typeof productSchema>`. `cipherStashText({ keyId })` resolves to `string` even though the wire is ciphertext.
- **Parameterization-free base codec.** Non-parameterized codecs (`text`, `int`, `bool`) carry no slots they don't use; parameterized codecs carry the same `encode` / `decode` / `encodeJson` / `decodeJson` shape with no extra fields. The two stop diverging.
- **Forward-compat for column-scoped stateful codecs.** CipherStash and similar codecs author against `(params, ctx)` today using the same surface pack authors already adopted. The contract-load runtime materialization is a documented contract; closing it for the full per-instance lifecycle (TML-2330) ships behind that already-stable surface.

### Trade-offs

- **`ColumnTypeDescriptor` grew an authoring-time `type` slot.** The optional `type?: (ctx: Ctx) => Codec` field is the price of letting the no-emit resolver read the factory's return type without reaching into the runtime codec registry. The slot is structurally optional, ignored by the IR serializer, and never appears in `contract.json`.
- **Two descriptors per codec id can coexist** for codecs whose authoring-time params can't round-trip through `contract.json`. See § Surface segregation below.

### Surface segregation (the JSON case)

`json(productSchema)` is the case where the model gets non-trivial. The user passes a live `StandardSchemaV1` value (e.g. an Arktype `Type`) at authoring time so `InferOutput` can flow through to the column's TypeScript type. But `contract.json` is JSON; it can serialize `{ schemaJson, type? }` (a JSON-Schema dump) but not a live Standard Schema. The same `pg/json@1` codec id therefore needs different representations on different surfaces:

- **Column authoring** registers `pgJsonCodec` (params: live Standard Schema) so `InferOutput` flows.
- **Emit path** registers `pgJsonLegacyCodec` (params: serialized JSON-Schema) so the emitter can render a TypeScript type from `typeParams`.
- **Runtime load** registers a runtime factory (params: serialized JSON-Schema) that compiles a validator for use during decode.

Each registers through a different framework slot. There is no runtime selection between descriptors — the surface is determined by which exports module wired the registration. The dual-registration pattern is documented at the registration site and tracked in § Future work.

This is the only case in the codebase today where a single codec id needs more than one descriptor. The pattern is named explicitly so future codecs in the same situation have a precedent rather than an ad-hoc workaround.

## Alternatives considered

**Type-level brand or `OutputType` HKT field on the codec.** The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>`. Rejected because the same information already lives in the factory function's TypeScript return type — encoding it twice and synchronizing the two encodings via `renderOutputType` is exactly the drift `function-is-signature` is meant to prevent.

**Optional `init(params, instance)` hook on the codec.** Codec carries `init?` separately from a factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — the same signature, the same lifecycle, the same purpose. One artifact, not two.

**A shared `columnFor(codec)(params)` helper.** A single `columnFor` helper turns any codec into a column-descriptor factory, type-discriminated on whether the codec is parameterized. Rejected because each pack ships a typed factory directly — `columnFor` would add no type information and would add an indirection at the call site.

**Global declaration-merged `CodecOutputTypes` interface.** Each codec augments a global registry; `FieldOutputType` reads the JS type from the merged registry. Rejected for ambient global pollution, order-dependent merging, and identity brittleness across two contracts in one program.

**Compute the output type from the codec's `output` field alone.** A "smart" `FieldOutputType` narrows the codec's `output` (e.g. `number[]`) using `typeParams`. Rejected: there is no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is what the factory's return type already does. Doesn't generalize to JSON-with-schema.

## Supersedes

The transitional `paramsSchema?` and `init?` fields on the SQL `Codec` extension and the `renderOutputType?` field on the SQL `Codec` and Mongo `MongoCodec` extensions (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). All three migrate to `ParameterizedCodecDescriptor`. Pack-author column-descriptor factories (`vectorColumn`, `charColumn`, `numericColumn`, …) are reshaped to return `ColumnTypeDescriptor & { type: (ctx) => Codec<…> }` — the user-call site (`field.column(vector(1536))`) is unchanged.

## Resolves

- **TML-2229.** `vector(1536)` and `json(schema)` resolve correctly in the no-emit path.
- **The deferred no-emit fix from [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).** The `renderOutputType` it introduced moves to its long-term home on the descriptor; the no-emit path now resolves through the factory's return type without consulting it.

## References

- [ADR 186 — Codec-dispatched type rendering](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). Established codec ownership of TypeScript output rendering; deferred the no-emit fix this ADR closes.
- [ADR 204 — Operations as TypeScript functions](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md). The "function is the signature" precedent applied here.
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md). Established the pattern of codecs owning their representations.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md). Established `typeParams` on storage columns.
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md). Introduced typed JSON columns with Standard Schema.
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md). The trait system gating per-instance helper extraction (`'json-validator'`).

## Future work

- **TML-2330 — collapse the IR `typeParams` shape** so a single descriptor handles the column-author, emit, and runtime surfaces for `pg/json@1`. Retires the dual-descriptor pattern documented above.
- **Mongo control-plane parameterized-codecs slot.** The Mongo control descriptor doesn't carry the slot today; the Mongo `vector(N)` factory is exported and tested but cannot register through control until the slot lands. Mongo demos don't use vectors, so the gap is authoring-time only.
- **`pgEnumCodec` placeholder factory audit.** The Postgres parameterized-codec registration includes `pgEnumCodec` so the emit path can render enum literal unions, but its `factory` is a registration-only placeholder — enum values are not parameterized in the curried-factory sense. Audit `allPostgresParameterizedCodecs` consumers before any future change that would invoke `descriptor.factory(typeParams)(ctx)` blindly across all entries.
