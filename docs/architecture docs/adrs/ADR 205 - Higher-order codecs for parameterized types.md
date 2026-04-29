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

Every codec is described by a single descriptor type:

```ts
export interface CodecDescriptor<P = void> {
  readonly codecId: string;
  readonly traits: readonly CodecTrait[];
  readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

A **parameterized codec** is a curried function plus the descriptor that registers it. The `vector(N)` codec authors as:

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

// Framework-registration surface — what the descriptor map consumes.
const pgVectorCodec: CodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  traits: ['equality'],
  targetTypes: ['vector'],
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vector(length),
};
```

The **function** (`vector`) is the only behavior-bearing artifact. Its TypeScript signature is what every type-level surface reads; its body is what the runtime invokes. The **descriptor** (`pgVectorCodec`) registers the function with the framework and carries the codec-id-keyed metadata the framework consults without the function in scope (codec-id-keyed traits / target types for trait gating; `paramsSchema` for JSON-boundary validation; `renderOutputType` for `contract.d.ts`).

**Non-parameterized codecs are the degenerate case.** A non-parameterized codec uses `P = void` and a constant factory that returns the same shared `Codec` instance for every column:

```ts
const sharedTextCodec: Codec = { id: 'pg/text@1', /* … */ };

const pgTextCodec: CodecDescriptor<void> = {
  codecId: 'pg/text@1',
  traits: ['equality', 'order', 'textual'],
  targetTypes: ['text'],
  paramsSchema: voidParamsSchema,
  factory: () => () => sharedTextCodec,
};
```

Whether a codec id "is parameterized" stops being a registration-time distinction; it's a property of `P` on the descriptor. The descriptor map indexes every descriptor by `codecId`; both `descriptorFor(codecId)` (codec-id-keyed metadata reads) and `forColumn(table, column)` (column-aware dispatch reads) resolve through the same map without branching.

`Ctx` is a small framework-supplied input the curried factory closes over:

```ts
export interface Ctx {
  readonly name: string;
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}
```

Pack authors never construct it. The contract-authoring builder synthesizes it at column-evaluation time; the runtime synthesizes it at contract-load time. `usedAt` is plural so a `storage.types` entry shared across multiple columns can derive shared per-instance state from the aggregated set (e.g. a CipherStash codec deriving one column-scoped key for every column referencing the entry).

Together this replaces three optional fields on the prior codec interface (`paramsSchema?`, `init?`, `renderOutputType?`) and the per-codec hand-rolled column helpers (`vectorColumn`, `charColumn`, `numericColumn`, …). The runtime `Codec` instance ends up parameterization-free; codec-id-keyed metadata lives on the descriptor.

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

`pnpm emit` walks the contract IR's models. For each scalar field, it looks up the descriptor by `codecId` in the descriptor map and calls `descriptor.renderOutputType(typeParams)`. The result is stamped into `FieldOutputTypes[Model][Field]` in `contract.d.ts`. If the descriptor has no renderer, the emitter falls through to the codec's base output type.

For columns that reference a named storage type via `typeRef` (rather than carrying inline `typeParams`), the SQL emitter implements an `EmissionSpi.resolveFieldTypeParams` callback that follows the typeRef into `storage.types[ref]` and returns its `typeParams`. The framework consults this resolver before falling back to inline params, so typeRef-based columns render with the same fidelity as inline-`typeParams` columns.

The emitter never reaches into a runtime codec object. The descriptor is the sole emit-path source of truth.

### 4. Runtime materialization and dispatch

When `contract.json` loads, `sql-runtime` builds a **descriptor map** keyed by `codecId`. Parameterized descriptors land directly; non-parameterized codecs registered through the legacy `codecs:` slot are auto-lifted into `CodecDescriptor<void>` via `synthesizeNonParameterizedDescriptor`. The map exposes two read APIs:

- **`descriptorFor(codecId)`** — codec-id-keyed metadata reads (consumed by trait gating, startup validation, the emit path's `renderOutputType` lookup). Non-branching for parameterized vs. non-parameterized.
- **`forColumn(table, column)`** — column-aware dispatch reads (consumed by encode and decode). Returns the per-instance parameterized codec for parameterized columns, the cached singleton for non-parameterized columns. Pre-built once at context construction by walking `storage.tables[].columns[]`:
  1. Look up the descriptor by `codecId`.
  2. For typeRef columns, reuse the resolved codec materialized once for the `storage.types` entry; `usedAt` aggregates every column referencing that entry.
  3. For inline-`typeParams` columns, validate via `descriptor.paramsSchema['~standard'].validate(typeParams)` and call `descriptor.factory(validatedParams)({ name: '<anon:t.c>', usedAt: [{ table, column }] })` once.
  4. For non-parameterized columns, call `descriptor.factory(undefined)(ctx)` once and cache the resulting `Codec` by codec id (the constant-factory contract guarantees the result is shared across columns).

The same factory the column author wrote at authoring time runs at contract-load time, with parameters round-tripped through the contract JSON. There is no parallel runtime function and no opportunity for drift.

JSON-with-schema validation lives **inside the resolved codec's `decode` body** rather than in a parallel validator registry. The per-library extension's factory rehydrates the schema at materialization time and closes over it; `decode(wire)` parses then validates, throwing a uniform `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection.

## Why this shape

Two pre-existing problems shaped the design:

**The no-emit TypeScript type didn't reflect parameterization.** Importing a contract definition without running `pnpm emit` was the fast path for iteration. But the type-level resolver `FieldOutputTypes<Definition>` ignored `typeParams`, so `vector(1536)` resolved to `number[]` and `json(productSchema)` resolved to `JsonValue`. Authors who relied on no-emit during development would only discover the precise type after a full emit step (TML-2229).

**Parameterization had been bolted onto the codec interface.** The codec carried `paramsSchema?` for runtime params validation, `init?` for materializing per-instance state, and `renderOutputType?` (added by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) for the emit path. None of these are wire-conversion concerns — they're framework-side metadata that just happened to share a record with `encode` / `decode`. Each parameterized codec also shipped a hand-rolled column-descriptor factory (`vectorColumn(N)`, `charColumn(N)`, …) whose return type collapsed to a generic `ColumnTypeDescriptor`. The function knew the shape of the output type; the codec didn't; the renderer encoded the relationship a third time. Three places to keep in sync, each owned by a different artifact.

Both problems share a root cause: the type-level facts about a parameterized column lived in three places (the column-helper factory, the codec record, the renderer) with no single source of truth.

[ADR 204](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) had already faced the analogous problem on the operations side: a declarative argument-spec record was replaced by a TypeScript function whose signature was the type-level surface and whose body was the runtime. We apply that pattern here. The function the column author writes is the function the runtime invokes is the function whose return type the no-emit resolver reads. Drift between a declarative record and a matching runtime function is impossible because there is no declarative record.

## Consequences

### What works better

- **One artifact per codec.** The pack author writes one curried factory function and one descriptor. The descriptor's `renderOutputType` is the only piece the framework owns separately, and only because the emit path runs without the factory in scope.
- **Type fidelity end-to-end.** `vector(1536)` resolves to `Vector<1536>` at authoring time, in the no-emit path, in the emitted `contract.d.ts`, and at runtime decode. `arktypeJson(ProductSchema)` resolves to the schema's inferred output. `cipherStashText({ keyId })` resolves to `string` even though the wire is ciphertext.
- **Non-branching descriptor reads.** `descriptorFor('pg/text@1').traits` and `descriptorFor('pg/vector@1').traits` use the same call shape. Non-parameterized codecs are the degenerate `P = void` case; consumers don't ask "is this codec parameterized" before reading metadata.
- **Parameterization-free runtime instance.** The `Codec` instance carries `encode` / `decode` / `encodeJson` / `decodeJson` and the codec-id-keyed metadata (`id`, `traits`, `targetTypes`, `meta`). The descriptor is the long-term home for that metadata; the runtime instance retains the fields for the legacy registry's sake (Phase 3.5b of codec-registry-unification, tracked under TML-2357, narrows them off).
- **Forward-compat for column-scoped stateful codecs.** CipherStash and similar codecs author against `(params, ctx)` today using the same surface pack authors already adopted. The contract-load runtime materialization is a documented contract.

### Trade-offs

- **`ColumnTypeDescriptor` grew an authoring-time `type` slot.** The optional `type?: (ctx: Ctx) => Codec` field is the price of letting the no-emit resolver read the factory's return type without reaching into the runtime codec registry. The slot is structurally optional, ignored by the IR serializer, and never appears in `contract.json`.
- **Per-library extensions own JSON-with-schema.** A schema-typed JSON column is not a postgres-adapter concept; it's a per-library concept (arktype, zod, valibot each have their own serialize/rehydrate story). The cost is one more import for users who want a typed JSON column; the benefit is that each library ships a lossless pipeline rather than a generic Standard-Schema-driven shape that's lossy for narrowed types.

### JSON-with-schema (per-library extensions)

`@prisma-next/extension-arktype-json` ships `arktypeJson(schema)`. The codec id (`arktype/json@1`) is library-bound, not target-bound. The factory eagerly serializes `schema.expression` (TypeScript-source-like rendering) and `schema.json` (arktype's internal IR) into `typeParams` at the column-author site; the descriptor's factory rehydrates via `ark.schema(typeParams.jsonIr)` and validates internally in `decode`. The emit-path renderer reads `expression` directly so `contract.d.ts` carries the schema's source-like rendering with full fidelity.

The postgres adapter retains only the non-parameterized raw-JSON / raw-JSONB codecs (`pg/json@1`, `pg/jsonb@1`) — schema-typed JSON columns ship from extension packages.

Earlier iterations of this work split JSON-with-schema across three descriptors (column-author / emit-path / runtime) under the framing "surface segregation, not dynamic dispatch." That framing is superseded — per-library extensions own the codec end-to-end with a single descriptor each.

## Alternatives considered

**Type-level brand or `OutputType` HKT field on the codec.** The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>`. Rejected because the same information already lives in the factory function's TypeScript return type — encoding it twice and synchronizing the two encodings via `renderOutputType` is exactly the drift `function-is-signature` is meant to prevent.

**Optional `init(params, instance)` hook on the codec.** Codec carries `init?` separately from a factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — the same signature, the same lifecycle, the same purpose. One artifact, not two.

**A shared `columnFor(codec)(params)` helper.** A single `columnFor` helper turns any codec into a column-descriptor factory, type-discriminated on whether the codec is parameterized. Rejected because each pack ships a typed factory directly — `columnFor` would add no type information and would add an indirection at the call site.

**Global declaration-merged `CodecOutputTypes` interface.** Each codec augments a global registry; `FieldOutputType` reads the JS type from the merged registry. Rejected for ambient global pollution, order-dependent merging, and identity brittleness across two contracts in one program.

**Compute the output type from the codec's `output` field alone.** A "smart" `FieldOutputType` narrows the codec's `output` (e.g. `number[]`) using `typeParams`. Rejected: there is no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is what the factory's return type already does. Doesn't generalize to JSON-with-schema.

## Supersedes

The transitional `paramsSchema?` and `init?` fields on the SQL `Codec` extension and the `renderOutputType?` field on the SQL `Codec` and Mongo `MongoCodec` extensions (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). All three migrate to `CodecDescriptor`. Pack-author column-descriptor factories (`vectorColumn`, `charColumn`, `numericColumn`, …) are reshaped to return `ColumnTypeDescriptor & { type: (ctx) => Codec<…> }` — the user-call site (`field.column(vector(1536))`) is unchanged.

The intermediate `ParameterizedCodecDescriptor<P>` type (introduced as a sister type during the codec-model-unification project) is renamed to `CodecDescriptor<P = void>`; non-parameterized codecs become the degenerate case rather than a separate registration path. The previous `ParameterizedCodecDescriptor` name persists as a deprecated alias during the registration-side migration (Phase 3.5b of codec-registry-unification, tracked under TML-2357).

## Resolves

- **TML-2229.** `vector(1536)`, `arktypeJson(schema)`, and other parameterized columns resolve correctly in the no-emit path AND through the emit path (typeRef columns included, via `EmissionSpi.resolveFieldTypeParams`).
- **The deferred no-emit fix from [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).** The `renderOutputType` it introduced moves to its long-term home on the descriptor; the no-emit path now resolves through the factory's return type without consulting it.

## References

- [ADR 186 — Codec-dispatched type rendering](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). Established codec ownership of TypeScript output rendering; deferred the no-emit fix this ADR closes.
- [ADR 204 — Operations as TypeScript functions](ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md). The "function is the signature" precedent applied here.
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md). Established the pattern of codecs owning their representations.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md). Established `typeParams` on storage columns.
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md). Introduced typed JSON columns with Standard Schema. Per-library extensions (e.g. `@prisma-next/extension-arktype-json`) now own the typed JSON column shape.
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md). The trait system gating per-instance helper extraction.

## Future work

- **TML-2357 — registration-side migration of the unified `CodecDescriptor`.** Phase 3.5a of codec-registry-unification landed the read-surface unification (`descriptorFor` non-branching across parameterized vs. non-parameterized codecs); Phase 3.5b — narrowing the runtime `Codec` instance to drop codec-id-keyed metadata, migrating every codec contributor to ship a `CodecDescriptor` directly, deleting the legacy `codecs:` slot, and threading `ParamRef.refs` for encode-side `forColumn` dispatch — is tracked under TML-2357.
- **Mongo control-plane parameterized-codecs slot.** The Mongo control descriptor doesn't carry the slot today; the Mongo `vector(N)` factory is exported and tested but cannot register through control until the slot lands. Mongo demos don't use vectors, so the gap is authoring-time only.
- **`pgEnumCodec` placeholder factory audit.** The Postgres parameterized-codec registration includes `pgEnumCodec` so the emit path can render enum literal unions, but its `factory` is a registration-only placeholder — enum values are not parameterized in the curried-factory sense. Audit `allPostgresParameterizedCodecs` consumers before any future change that would invoke `descriptor.factory(typeParams)(ctx)` blindly across all entries.
