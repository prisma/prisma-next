# ADR 207 — Higher-order codecs for parameterized types

## At a glance

A user authors one line of TypeScript:

```ts
import { vector } from '@prisma-next/extension-pgvector/column-types';

const Document = model('Document', {
  fields: {
    embedding: field.column(vector(1536)).optional(),
  },
});
```

Three surfaces resolve from that single function call:

- The TypeScript view of `Document.embedding` is `Vector<1536> | null` — the literal `1536` is preserved, not widened to `number`.
- `pnpm emit` writes the same type into `contract.d.ts`.
- At runtime, decoding the wire form `'[1.2, 3.4, …]'` produces a value the type system already named `Vector<1536>`.

Before this ADR, each parameterized codec encoded its parameter relationship in three places: the column-helper factory function, an optional `paramsSchema` / `init` slot on the runtime `Codec`, and an optional `renderOutputType` slot (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). This ADR unifies those three surfaces under a single descriptor record so the user's `vector(1536)` is *the* source of truth across authoring, type checking, emitting, and runtime decoding.

## Decision

Every codec is described by a single descriptor type:

```ts
export interface CodecDescriptor<P = void> {
  readonly codecId: string;
  readonly traits: readonly CodecTrait[];
  readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string | undefined;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

A **parameterized codec** is a curried factory plus the descriptor that registers it. The `vector(N)` codec authors as:

```ts
// Pack-author surface — what users import and call.
function vector<N extends number>(length: N): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: N };
} {
  return { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length } };
}

// Framework-registration surface — what the descriptor map consumes.
const pgVectorCodec: CodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  traits: ['equality'],
  targetTypes: ['vector'],
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: (_params) => (_ctx) => sharedVectorCodec,
};
```

The descriptor registers the codec id with the framework and carries the codec-id-keyed metadata the framework consults without the runtime instance in scope: traits and target types for trait gating; `paramsSchema` for JSON-boundary validation; `renderOutputType` for `contract.d.ts`; the curried `factory` for runtime materialization.

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

Pack authors never construct it. The runtime synthesizes it at contract-load time: `name` is the named-instance identity (the `storage.types` entry name, an `<anon:t.c>` for inline-`typeParams` columns, or a `<shared:codecId>` sentinel for non-parameterized codecs); `usedAt` is plural so a `storage.types` entry shared across multiple columns can derive shared per-instance state from the aggregated set (e.g. a column-scoped encryption codec deriving one key for every column referencing the entry).

`paramsSchema` is typed as **Standard Schema** (`StandardSchemaV1<P>`), not arktype-specific. The arktype `Type` already implements Standard Schema via its `~standard` getter, so existing arktype-typed descriptors satisfy the new shape transparently while `framework-components` itself takes no dependency on arktype. The runtime calls `paramsSchema['~standard'].validate(typeParams)` synchronously and rejects Promise-returning validators with `RUNTIME.TYPE_PARAMS_INVALID`.

## How it composes

The same `vector(1536)` participates in four code paths. Each reads a different aspect of the same artifact — never a parallel one.

### 1. Column authoring

`vector(1536)` returns a `ColumnTypeDescriptor` carrying both the data the contract IR needs (`codecId: 'pg/vector@1'`, `nativeType: 'vector'`, `typeParams: { length: 1536 }`) and, for codecs that need it, the curried factory itself, threaded through a first-class `type: (ctx: Ctx) => Codec<…>` slot. The contract-authoring builder consumes the data part for the IR; the `type` slot is authoring-time only and is never serialized to `contract.json`.

### 2. No-emit type resolution

`@prisma-next/sql-contract-ts`'s `FieldOutputType<Definition, Model, Field>` follows `typeRef` through `storage.types`, then synthetically applies `Ctx` to the column's `type` slot at the type level and reads the `Js` parameter off the resulting `Codec<…, Js>`. For `vector(1536)`, this produces `Vector<1536>` (literal `N` preserved through curried application). For non-parameterized columns (no `type` slot), it falls back to `CodecTypes[codecId]['output']`. Nullability is reattached uniformly.

### 3. Emit-path rendering

`pnpm emit` walks the contract IR's models. For each scalar field, it looks up the codec by `codecId` and consults `renderOutputType(typeParams)`. The result is stamped into `FieldOutputTypes[Model][Field]` in `contract.d.ts`. If the codec has no renderer, the emitter falls through to the codec's base output type.

For columns that reference a named storage type via `typeRef` (rather than carrying inline `typeParams`), the SQL emitter implements an `EmissionSpi.resolveFieldTypeParams(modelName, fieldName, model, contract)` callback that walks `storage.fields → storage.tables → storage.types` and returns the named instance's `typeParams`. The framework consults this resolver before falling back to inline params, so typeRef-based columns render with the same fidelity as inline-`typeParams` columns. Mongo and other families that don't use named storage types simply don't implement the optional hook.

### 4. Runtime materialization and dispatch

When `contract.json` loads, `sql-runtime` builds a **descriptor map** keyed by `codecId`. Parameterized descriptors land directly; non-parameterized codecs registered through the legacy `codecs:` slot are auto-lifted into `CodecDescriptor<void>` via `synthesizeNonParameterizedDescriptor(codec)` — a synthesis bridge that wraps an existing async-shaped `Codec` (per [ADR 204 — Single-Path Async Codec Runtime](ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)) into a descriptor whose constant factory returns the same codec instance for every column. The map exposes two read APIs:

- **`descriptorFor(codecId)`** — codec-id-keyed metadata reads (consumed by trait gating, startup validation, the emit path's `renderOutputType` lookup). Non-branching for parameterized vs. non-parameterized.
- **`forColumn(table, column)`** — column-aware dispatch reads (consumed by encode and decode). Returns the per-instance parameterized codec for parameterized columns, the cached singleton for non-parameterized columns. Pre-built once at context construction by walking `storage.tables[].columns[]`:
  1. Look up the descriptor by `codecId`.
  2. For typeRef columns, reuse the resolved codec materialized once for the `storage.types` entry; `usedAt` aggregates every column referencing that entry.
  3. For inline-`typeParams` columns, validate via `descriptor.paramsSchema['~standard'].validate(typeParams)` and call `descriptor.factory(validatedParams)({ name: '<anon:t.c>', usedAt: [{ table, column }] })` once.
  4. For non-parameterized columns, call `descriptor.factory(undefined)(ctx)` once and cache the resulting `Codec` by codec id (the constant-factory contract guarantees the result is shared across columns).

JSON-with-schema validation lives **inside the resolved codec's `decode` body** rather than in a parallel validator registry. The per-library extension's factory rehydrates the schema at materialization time and closes over it; `decode(wire)` parses then validates, throwing a uniform `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection.

## Why this shape

Two pre-existing problems shaped the design:

**The no-emit TypeScript type didn't reflect parameterization.** Importing a contract definition without running `pnpm emit` was the fast path for iteration. But the type-level resolver `FieldOutputTypes<Definition>` ignored `typeParams`, so `vector(1536)` resolved to `number[]` and `json(productSchema)` resolved to `JsonValue`. Authors who relied on no-emit during development would only discover the precise type after a full emit step (TML-2229).

**Parameterization had been bolted onto the codec interface.** The codec carried `paramsSchema?` for runtime params validation, `init?` for materializing per-instance state, and `renderOutputType?` (added by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) for the emit path. None of these are wire-conversion concerns — they're framework-side metadata that just happened to share a record with `encode` / `decode`. Each parameterized codec also shipped a hand-rolled column-descriptor factory whose return type collapsed to a generic `ColumnTypeDescriptor`. The function knew the shape of the output type; the codec didn't; the renderer encoded the relationship a third time. Three places to keep in sync, each owned by a different artifact.

Both problems share a root cause: the type-level facts about a parameterized column lived in three places (the column-helper factory, the codec record, the renderer) with no single source of truth.

[ADR 206](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) had already faced the analogous problem on the operations side: a declarative argument-spec record was replaced by a TypeScript function whose signature was the type-level surface and whose body was the runtime. We apply that pattern here. The function the column author writes is the function the runtime invokes is the function whose return type the no-emit resolver reads. Drift between a declarative record and a matching runtime function is impossible because there is no declarative record.

## Consequences

### What works better

- **One artifact per codec.** The pack author writes one curried factory function and one descriptor. The descriptor's `renderOutputType` is the only piece the framework owns separately, and only because the emit path runs without the factory in scope.
- **Type fidelity end-to-end.** `vector(1536)` resolves to `Vector<1536>` at authoring time, in the no-emit path, in the emitted `contract.d.ts`, and at runtime decode. `arktypeJson(ProductSchema)` resolves to the schema's inferred output. Future column-scoped stateful codecs (e.g. encryption) resolve to their declared output even though the wire is ciphertext.
- **Non-branching descriptor reads.** `descriptorFor('pg/text@1').traits` and `descriptorFor('pg/vector@1').traits` use the same call shape. Non-parameterized codecs are the degenerate `P = void` case; consumers don't ask "is this codec parameterized" before reading metadata. The four sites that previously read traits via `context.codecs.traitsOf(codecId)` migrated to `context.codecDescriptors.descriptorFor(codecId).traits` without behavior change.
- **Framework-components stays library-agnostic.** `paramsSchema: StandardSchemaV1<P>` keeps arktype confined to the codec authors that opt into it; a future extension that prefers zod or valibot satisfies the same descriptor shape without `framework-components` depending on either library.
- **Forward-compat for column-scoped stateful codecs.** Column-scoped encryption and similar codecs author against `(params, ctx)` today using the same surface pack authors already adopted. The contract-load runtime materialization is a documented contract.

### Trade-offs

- **`ColumnTypeDescriptor` grew an authoring-time `type` slot.** The optional `type?: (ctx: Ctx) => Codec` field is the price of letting the no-emit resolver read the factory's return type without reaching into the runtime codec registry. The slot is structurally optional, ignored by the IR serializer, and never appears in `contract.json`.
- **Per-library extensions own JSON-with-schema.** A schema-typed JSON column is not a postgres-adapter concept; it's a per-library concept. The cost is one more import for users who want a typed JSON column; the benefit is that each library ships a lossless pipeline rather than a generic Standard-Schema-driven shape that's lossy for narrowed types.
- **Encode-side `forCodecId` legacy fallback (carved out, AC-5-deferred).** `ParamRef` carries `codecId` but not `(table, column)` today, so encode-side dispatch consults `contractCodecs.forCodecId(codecId)` instead of `forColumn`. The fallback works for the parameterized codecs shipped at this ADR's landing because their encode is per-instance-stateless w.r.t. params (pgvector formats `[v1,v2,…]` regardless of declared length; arktype-json's encode is `JSON.stringify`). The carve-out is documented at the registry boundary in `relational-core/src/ast/codec-types.ts:101-129` and retires under TML-2357 once `ParamRef.refs` is threaded through column-bound construction sites.
- **Heterogeneous-`P` registry boundary.** `descriptorFor(codecId): CodecDescriptor<P>` is structurally heterogeneous across codec ids — `P` is `void` for `pg/text@1`, `{ length: number }` for `pg/vector@1`, `{ expression; jsonIr }` for `arktype/json@1`, etc. The registry's interface methods cannot be honestly typed at the registry level without `<any>` at the boundary; consumers narrow per codec id at the call site. A typed-dispatch / sealed-visitor refactor would eliminate the suppressions but is not in scope; the registry interface uses `CodecDescriptor<any>` with documented one-line rationale comments at the four production sites.
- **Emit-only `Codec` shim for per-library extensions.** The framework emitter consults a single codec-id-keyed `CodecLookup` to resolve `renderOutputType`. Per-library extensions whose codec instance is materialized through the descriptor's factory at runtime can't naturally participate in that lookup at emit time. The arktype-json package ships an emit-only `Codec` instance (`arktypeJsonEmitCodec`) carrying just `renderOutputType`; encode/decode are sentinels that throw if invoked. A future cleanup that routes the emit path through `descriptorFor` retires the shim — tracked under TML-2357.

### Per-library JSON extensions

`@prisma-next/extension-arktype-json` ships `arktypeJson(schema)`. The codec id (`arktype/json@1`) is library-bound, not target-bound. The factory eagerly serializes `schema.expression` (TypeScript-source-like rendering) and `schema.json` (arktype's internal IR) into `typeParams` at the column-author site; the descriptor's factory rehydrates via `ark.schema(typeParams.jsonIr)` and validates internally in `decode`. The emit-path renderer reads `expression` directly so `contract.d.ts` carries the schema's source-like rendering with full fidelity.

The postgres adapter retains only the non-parameterized raw-JSON / raw-JSONB codecs (`pg/json@1`, `pg/jsonb@1`) — schema-typed JSON columns ship from extension packages. Future per-library extensions (`zod/json@1`, `valibot/json@1`) follow the same pattern when each library has a clean serialize / rehydrate story.

## Alternatives considered

**Type-level brand or `OutputType` HKT field on the codec.** The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>`. Rejected because the same information already lives in the factory function's TypeScript return type — encoding it twice and synchronizing the two encodings via `renderOutputType` is exactly the drift `function-is-signature` is meant to prevent.

**Optional `init(params, instance)` hook on the codec.** Codec carries `init?` separately from a factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — the same signature, the same lifecycle, the same purpose. One artifact, not two. (The legacy `init?` slot on `CodecParamsDescriptor` and the SQL `Codec` extension persists as an adapter-level surface during the transition; retirement tracked under TML-2357.)

**A shared `columnFor(codec)(params)` helper.** A single `columnFor` helper turns any codec into a column-descriptor factory, type-discriminated on whether the codec is parameterized. Rejected because each pack ships a typed factory directly — `columnFor` would add no type information and would add an indirection at the call site.

**Global declaration-merged `CodecOutputTypes` interface.** Each codec augments a global registry; `FieldOutputType` reads the JS type from the merged registry. Rejected for ambient global pollution, order-dependent merging, and identity brittleness across two contracts in one program.

## Supersedes

The transitional `paramsSchema?` and `init?` fields on the SQL `Codec` extension and the `renderOutputType?` field on the SQL `Codec` and Mongo `MongoCodec` extensions (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). All three migrate to `CodecDescriptor`. Pack-author column-descriptor factories (`vector(N)`, `charColumn(N)`, `numericColumn(p, s)`, …) are reshaped to return `ColumnTypeDescriptor & { type?: (ctx) => Codec<…> }` for codecs that need no-emit type-level access — the user-call site (`field.column(vector(1536))`) is unchanged.

The intermediate `CodecParamsDescriptor<P>` type at the adapter compile-time boundary persists as a legacy surface during the registration-side migration; retirement tracked under TML-2357 (see "Future work" below). Phase B of this ADR's landing migrated the runtime-side descriptor (in `@prisma-next/sql-runtime`) to the unified shape; the adapter-level `CodecParamsDescriptor` retires alongside the single registration slot.

## Resolves

- **TML-2229.** `vector(1536)`, `arktypeJson(schema)`, and other parameterized columns resolve correctly in the no-emit path AND through the emit path (typeRef columns included, via `EmissionSpi.resolveFieldTypeParams`).
- **The deferred no-emit fix from [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).** The `renderOutputType` it introduced moves to its long-term home on the descriptor; the no-emit path now resolves through the factory's return type without consulting it.

## References

- [ADR 186 — Codec-dispatched type rendering](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). Established codec ownership of TypeScript output rendering; deferred the no-emit fix this ADR closes.
- [ADR 204 — Single-Path Async Codec Runtime](ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). The async codec interface this ADR composes with — `factory(params)(ctx)` returns a `Codec` whose `encode`/`decode` are Promise-returning at the public boundary, and the synthesis bridge wraps existing async codecs without touching their methods.
- [ADR 206 — Operations as TypeScript functions](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md). The "function is the signature" precedent applied here.
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md). Established the pattern of codecs owning their representations.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md). Established `typeParams` on storage columns.
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md). Introduced typed JSON columns with Standard Schema. Per-library extensions (`@prisma-next/extension-arktype-json`) now own the typed JSON column shape.
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md). The trait system gating per-instance helper extraction (the `'json-validator'` trait gates the JSON-schema validator registry's `validate` extraction; the registry itself is unused by arktype-json, which validates inside its `decode` body).

## Future work

- **TML-2357 — registration-side migration of the unified `CodecDescriptor`.** This ADR's landing covered the read-surface unification (`descriptorFor` non-branching across parameterized vs. non-parameterized codec ids) and the parameterized-descriptor migration for the codecs main shipped at the time (pgvector, postgres json/jsonb). The remaining work tracked under TML-2357:
    - **T3.5.2** — narrow the runtime `Codec` instance to drop codec-id-keyed metadata (`id`, `traits`, `targetTypes`, `meta`). The descriptor is the long-term home for those fields; the runtime instance retains them today for the legacy registry's sake.
    - **T3.5.3** — migrate every non-parameterized codec contributor to ship a `CodecDescriptor` directly (~50 codecs across postgres / sqlite / sql-family / mongo). The synthesis bridge auto-lifts the legacy `codecs:` slot today; T3.5.3 retires the bridge.
    - **T3.5.4** — collapse the parallel registration slots into one (`codecs:` retires; `parameterizedCodecs:` retires; contributors ship one descriptor list).
    - **T3.5.9 / T3.5.10 / T3.5.11** — thread `ParamRef.refs: { table; column }` through the SQL builder's column-bound construction sites so encode-side dispatch resolves through `forColumn` (the AC-5-deferred encode fallback retires; the `forCodecId` fallback retires for parameterized codec ids).
    - **T3.5.12** — delete the `JsonSchemaValidatorRegistry` infrastructure (validation moves into the resolved codec's `decode` body uniformly; the `'json-validator'` trait becomes vestigial or persists only as a structural marker).
    - **Emit-path consultation through `descriptorFor`.** The framework emitter currently consults a single codec-id-keyed `CodecLookup` for `renderOutputType`. Routing the emit path through the descriptor map directly retires the per-library "emit-only Codec shim" pattern (currently shipped by `@prisma-next/extension-arktype-json`).
- **Mongo control-plane parameterized-codecs slot.** The Mongo control descriptor doesn't carry the slot today; Mongo demos don't use vectors, so the gap is authoring-time only. A future migration aligns Mongo with the SQL family's slot shape.
- **Future schema libraries.** zod, valibot, etc. ship as parallel per-library extensions when each has a clean serialize / rehydrate story. The arktype-json package is the structural template.
