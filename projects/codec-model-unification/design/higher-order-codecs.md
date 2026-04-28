# Design — Higher-order codecs

**Audience:** framework maintainers and reviewers of the M1 / M2 PRs.

**What this doc covers:** the higher-order-codec model — the curried factory function, the sister `ParameterizedCodecDescriptor`, the unchanged base `Codec` interface, and the no-emit `FieldOutputType` rewrite. Companion docs:

- [authoring-ergonomics.md](authoring-ergonomics.md) — pack-author surface, JSON factory, worked examples.
- [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md) — runtime materialization contract, downstream extension fit.

---

## Decision

A parameterized codec is a curried higher-order function plus a sister descriptor. The function is the single artifact for type-level resolution and runtime instantiation; the descriptor registers it with the framework.

```typescript
// The function — exported for column authoring.
function vector<N extends number>(length: N) {
  return (ctx: Ctx): Codec<'pg/vector@1', ['equality'], string, Vector<N>> => ({
    id: 'pg/vector@1',
    targetTypes: ['vector'],
    traits: ['equality'],
    typeParams: { length },                                  // serialized to contract.json
    encode: (v: number[]) => `[${v.join(',')}]`,
    decode: (w: string) => parseVector(w),
    encodeJson: (v) => v as JsonValue,
    decodeJson: (j) => j as number[],
    meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
  });
}

// The descriptor — exported for framework registration.
export const pgVectorCodec: ParameterizedCodecDescriptor<{ length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: vector,
};

interface Ctx {
  readonly name: string;                                              // storage.types instance name
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

interface ParameterizedCodecDescriptor<P = Record<string, unknown>> {
  readonly codecId: string;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

The base `Codec` interface in `@prisma-next/framework-components/codec` is **unchanged**. The currently-optional `paramsSchema?` and `init?` on the SQL `Codec` extension are **removed** — they migrate to `ParameterizedCodecDescriptor` (paramsSchema) and the factory function (init's intent is absorbed into the closure the factory returns).

The no-emit `FieldOutputType<Definition>` is rewritten to follow `typeRef` through `storage.types`, then read the `Codec`'s `Js` slot off the (synthetically `ctx`-applied) factory result. No HKT.

This satisfies [AC-1](../spec.md#ac-1-higher-order-codec-factories-type-resolve-correctly), [AC-2](../spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly), [AC-4](../spec.md#ac-4-existing-parameterized-codecs-migrated), and [AC-6](../spec.md#ac-6-cipherstash-forward-compat-surface-is-locked).

### Driving cases

The decisions below are checked against three concrete cases from [spec.md § Cases that pin the design](../spec.md#cases-that-pin-the-design):

- [**Case V — Vector**](../spec.md#case-v--vector-literal-typed-numeric-param) (literal-typed numeric param). Pins literal preservation through curried application and the agreement between emit (`renderOutputType`) and no-emit (factory return type) paths. Worked code: [authoring-ergonomics.md#case-v](authoring-ergonomics.md#case-v--vector-literal-typed-numeric-param).
- [**Case J — JSON-with-schema**](../spec.md#case-j--json-with-schema) (output type derived from a schema *value*). Pins `paramsSchema: StandardSchemaV1<…>` and the factory's ability to project a type out of a schema parameter (`InferOutput<S>`). Worked code: [authoring-ergonomics.md#case-j](authoring-ergonomics.md#case-j--json-with-schema).
- [**Case C — CipherStash column-scoped encryption**](../spec.md#case-c--cipherstash-column-scoped-encryption). Pins the `Ctx` shape and the runtime materialization contract — `factory(params)(ctx)` runs once per `storage.types` instance. Worked code: [runtime-contract-and-compatibility.md#case-c](runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption).

Each subsection below indicates which case(s) it answers to.

---

## The codec interface

*Driving cases:* V, J, C.

The base `Codec` interface in [packages/1-framework/1-core/framework-components/src/codec-types.ts](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) is unchanged:

```typescript
export interface Codec<Id extends string = string, TTraits extends readonly CodecTrait[] = readonly CodecTrait[], TWire = unknown, TJs = unknown> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  encode?(value: TJs): TWire;
  decode(wire: TWire): TJs;
  encodeJson(value: TJs): JsonValue;
  decodeJson(json: JsonValue): TJs;
  readonly renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

We propose **one tightening**: `renderOutputType` on the base `Codec` migrates to `ParameterizedCodecDescriptor.renderOutputType` (where it belongs — only parameterized codecs have it). Locked at M1 ([open question 2](../spec.md#open-questions)). Once moved, the base `Codec` carries no parameterization slots at all.

The SQL `Codec` extension in [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) currently adds `meta?`, `paramsSchema?`, and `init?(params)`. After this project: `meta?` stays; `paramsSchema?` and `init?` are removed.

### Why the interface barely changes

The interface barely changes because the work doesn't live in the interface. It lives in:

- The factory function (whose type signature is the no-emit fix).
- The descriptor that registers the factory and its metadata.

Compare with ADR 204: the `Codec` interface is to a parameterized codec what `OperationEntry` is to an operation — a runtime descriptor for the registry. The "function-as-signature" pattern keeps the function separate from the descriptor metadata.

---

## Anatomy of a higher-order codec

*Driving cases:* V, J. Case V needs literal numeric inference (`{ length: 1536 }` → `Vector<1536>`); Case J needs the factory to project a type out of a schema input (`{ schema: S }` → `InferOutput<S>`). Both fall out of standard TS function-type inference applied to the curried factory.

### Shape

```typescript
function vector<N extends number>(length: N): (ctx: Ctx) =>
  Codec<'pg/vector@1', ['equality'], string, Vector<N>> {
  return (ctx: Ctx) => ({
    id: 'pg/vector@1',
    targetTypes: ['vector'],
    traits: ['equality'],
    typeParams: { length },
    encode: (v: number[]) => `[${v.join(',')}]`,
    decode: (w: string) => parseVector(w),
    encodeJson: (v) => v as JsonValue,
    decodeJson: (j) => j as number[],
    meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
  });
}
```

### Why curried

The user writes `.column('embedding', vector(1536))` at the column site. The user knows `length` (the params); the contract-authoring API knows `(table, column)` (the `ctx`). Currying is the natural split — the user provides what they know, the framework provides what it knows.

The currying is at the *value* level (a function returning a function). At the *type* level, TypeScript treats the partially applied result as `(ctx: Ctx) => Codec<…>`; FieldOutputType reads the `Codec`'s `Js` slot from there.

### Why the same function runs at runtime, too

When `contract.json` is loaded, the runtime walks every `storage.types` entry, validates `typeParams` via the descriptor's `paramsSchema`, then calls `descriptor.factory(typeParams)(ctx)` with the same params and ctx that produced the entry at authoring time. The returned `Codec` is what handles encode/decode at query time.

So the factory runs:

1. **At contract authoring** — to produce a codec object whose data part (`id`, `typeParams`) goes into the contract IR. The closures returned are discarded.
2. **At runtime load** — to recreate the codec, this time keeping the closures (which are what `encode`/`decode` execute).

Two invocations, same function, equivalent inputs both times. There is no separate `init` hook because the factory IS what `init` would have been.

### How `ctx` flows

The contract-authoring builder, when it hits `.column('embedding', value)`:

1. Detects `value` is a function of one argument (the curried HoC partial application).
2. Computes `ctx = { name: '<anon:Document.embedding>', usedAt: [{ table: 'Document', column: 'embedding' }] }`.
3. Calls `value(ctx)` to get the codec.
4. Stores the codec's data part in the contract IR's column descriptor.

For `storage.types` entries, `ctx` is computed *after* aggregating which columns reference each entry. Detail: [authoring-ergonomics.md#how-ctx-is-supplied](authoring-ergonomics.md#how-ctx-is-supplied).

---

## The descriptor

*Driving cases:* V, J, C.

`ParameterizedCodecDescriptor` is the registration shape:

```typescript
interface ParameterizedCodecDescriptor<P = Record<string, unknown>> {
  readonly codecId: string;
  readonly paramsSchema: StandardSchemaV1<P>;
  readonly renderOutputType?: (params: P) => string;
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}
```

Field-by-field:

- **`codecId`**: the registry key (e.g. `'pg/vector@1'`). Same id present on the codec returned by the factory; the framework checks they match at registration time.
- **`paramsSchema`**: a Standard Schema (Arktype, Zod, Valibot, …). Validates JSON-sourced params at the contract boundary — both PSL → IR and `contract.json` → runtime. Required.
- **`renderOutputType`**: emit-path string for `contract.d.ts`. Optional. Absent renderers cause the emitter to fall back to the codec's base output type.
- **`factory`**: the curried higher-order codec. The descriptor's only behavior; everything else is data.

### Where the descriptor lives

Pack authors export the descriptor from their package. The runtime descriptor for the pack registers it through the existing `parameterizedCodecs` slot:

```typescript
const pgvectorRuntimeDescriptor = {
  // …other fields…
  parameterizedCodecs: () => [pgVectorCodec],
};
```

The runtime walks the registered descriptors at context-build time. This slot already exists today (carrying `paramsSchema` and `init?`); we only widen the descriptor to carry `factory` and to use `StandardSchemaV1` instead of arktype's `Type<…>`.

### Why a sister descriptor instead of properties on the function

Two reasons:

1. **ADR 204 precedent.** Operations ship as `{ method, self, impl }`. The function is a field. We're applying the same pattern.
2. **Type-erasure ergonomics.** `paramsSchema` and `renderOutputType` are runtime metadata; properties hung off the function (`vector.paramsSchema = …`) work but obscure the shape and complicate the type signature of the export.

---

## Rewriting the no-emit `FieldOutputType`

*Driving cases:* V, J, C. All three need the no-emit path to resolve the column's TS type through the factory's return type: V pins literal preservation, J pins schema-derived inference, C pins resolution through `typeRef` to a shared `storage.types` instance.

### Today's implementation

[packages/2-sql/2-authoring/contract-ts/src/contract-types.ts](../../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts):

```typescript
type FieldOutputType<Definition, ModelName, FieldName> =
  ModelStorageColumn<Definition, ModelName, FieldName> extends infer Col
    ? Col extends { readonly codecId: infer Id extends string }
      ? Id extends keyof CodecTypesFromDefinition<Definition>
        ? CodecTypesFromDefinition<Definition>[Id] extends { readonly output: infer O }
          ? Col extends { readonly nullable: true } ? O | null : O
          : unknown
        : unknown
      : unknown
    : unknown;
```

Three issues: doesn't read `Col['typeParams']`, doesn't follow `Col['typeRef']`, resolves only to the codec's *base* output regardless of params.

### Rewritten implementation (sketch)

The column at the model definition is no longer a literal `{ codecId, typeParams }`; it's the partially applied factory result, e.g. typed as `(ctx: Ctx) => Codec<'pg/vector@1', ['equality'], string, Vector<1536>>`. We read `Js` directly from there.

```typescript
type ResolveTypeRef<Definition, Col> =
  Col extends { readonly typeRef: infer Ref extends string }
    ? StorageTypesFromDefinition<Definition>[Ref] extends infer Resolved
      ? Resolved & { readonly nullable: Col extends { readonly nullable: true } ? true : false }
      : never
    : Col;

type CodecJs<C> = C extends Codec<string, readonly CodecTrait[], unknown, infer Js> ? Js : unknown;

type ApplyCtx<F> = F extends (ctx: Ctx) => infer C ? C : never;

type FieldOutputType<Definition, ModelName, FieldName> =
  ModelStorageColumn<Definition, ModelName, FieldName> extends infer Col
    ? ResolveTypeRef<Definition, Col> extends infer R
      ? R extends { readonly type: infer F }
        ? ApplyNullable<R, CodecJs<ApplyCtx<F>>>
        : R extends { readonly codecId: infer Id extends string }
          ? CodecBaseFromId<Definition, Id> extends infer Js
            ? ApplyNullable<R, Js>
            : unknown
          : unknown
      : unknown
    : unknown;
```

Three changes:

1. **`ResolveTypeRef` follows `typeRef`** through `storage.types` and reattaches the column's `nullable` flag.
2. **`type` field carries the partially applied factory** — its TS type is `(ctx: Ctx) => Codec<…>`. We synthetically apply `Ctx` at the type level and read `Js` off the resulting `Codec`.
3. **Fallback path** for non-parameterized columns (no `type` field, just `codecId`): unchanged — read the codec's base output type from the codec-types map.

### Why this is small

- No HKT, no `Apply` utility, no `OutputType` field on the codec — everything is direct function-type inference.
- No change to `ComputeColumnJsType`; it already delegates through `ExtractFieldOutputTypes<Contract>`.
- The synthetic test fixture in M2 lets us land the rewrite *before* any production codec migrates.

---

## Anonymous instances and `storage.types`

*Driving case:* C (sharing). V and J use anonymous instances by default and never need to think about it.

A column can carry parameters two ways:

```typescript
// Inline (factory called with column's ctx)
.column('embedding', vector(1536))

// Named (factory called once for the storage.types entry; columns reference it)
storage.types: { Embedding1536: vector(1536) }
.column('embedding', { typeRef: 'Embedding1536' })
```

For named: `ctx.name = 'Embedding1536'`; `ctx.usedAt` lists every column referencing the entry.

For inline: the runtime synthesizes an **anonymous instance** with deterministic name `<anon:${table}.${column}>`. `ctx.usedAt` has exactly one entry. Two columns with structurally identical inline `typeParams` produce two distinct anonymous instances; deduplication is the user's job — to share, use `storage.types`.

### Why this resolution

- **No surprise.** Sharing requires explicit opt-in via `storage.types`, matching how the rest of the IR works.
- **Clean `usedAt` semantics.** A consumer that needs sharing semantics (CipherStash deriving one key for many columns) sees exactly the columns the user intended.
- **Inline ergonomics preserved.** No forced promotion to `storage.types` for one-off columns.

Detail: [runtime-contract-and-compatibility.md#anonymous-vs-named-instances](runtime-contract-and-compatibility.md#anonymous-vs-named-instances).

---

## Rejected alternatives

### Type-level brand / `OutputType` HKT field on the codec

Earlier iteration of this project. The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>`. Rejected because the same information already lives in the factory function's TS return type — there's no reason to encode it twice and synchronize the two encodings via `renderOutputType`. The `as unknown as VectorOutputType` cast goes away. The `Codec` / `ParameterizedCodec` interface split goes away. The `Apply<F, P>` HKT machinery goes away.

### Optional `init(params, instance)` hook on the codec

Earlier iteration. Codec carries `init?` separately from a factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — same signature, same lifecycle, same purpose. One artifact, not two.

### `paramsSchema` and `renderOutputType` as properties on the function

Sketch:

```typescript
function vector<N extends number>(length: N) { … }
vector.paramsSchema = type({ length: 'number > 0' });
vector.renderOutputType = ({ length }: { length: number }) => `Vector<${length}>`;
```

Rejected because:

- Mixing function metadata with the function's value type complicates the export's public type.
- ADR 204 sets the precedent of `{ method, self, impl }`-style sister descriptors. Following it keeps the codec model and the operations model symmetrical.
- A descriptor object is easier to register through the existing `parameterizedCodecs` slot.

### Global `CodecOutputTypes` interface with declaration merging

Each codec augments a global registry:

```typescript
declare module '@prisma-next/framework-components' {
  interface CodecOutputTypes {
    'pg/vector@1': { /* output-type function */ };
  }
}
```

Rejected for ambient global pollution, order-dependent merging, and version/identity brittleness. Type errors point at the global, not the codec.

### Compute output type from the codec's `output` type alone

A "smart" `FieldOutputType` narrows the codec's existing `output` (e.g. `number[]`) using `typeParams`. Rejected: there's no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is what the factory's return type does. Doesn't generalize to JSON-with-schema.

### Per-extension factories carry parameter awareness without a typed return

Today's `vector(N)` returns a generic `ColumnTypeDescriptor & { typeParams: { length: N } }` — literal-preserving for `typeParams` but not for the column's resolved JS type. Have `FieldOutputType` consult both the column's `typeParams` and the codec's factory's return type. Rejected: TypeScript doesn't expose a factory's return type from a codec ID; doesn't unify `typeRef` and inline-`typeParams` paths; doesn't generalize. Replaced by giving the factory's return type the resolved `Js` directly.

### Uncurried factory `(params, ctx) => Codec`

Cleaner-looking signature, but at the user's call site `.column('embedding', vector(1536, ?))` the user has no `ctx` — they'd have to either thread it manually or the API would have to call `vector` with a stub then re-call later. Currying lets the user write `vector(1536)` and the API call the result with `ctx` once it's known, with no stub or re-call.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §1–§7](../spec.md#how-it-works), [Acceptance criteria AC-1, AC-2, AC-4, AC-6](../spec.md#acceptance-criteria).
- Plan: [plan.md M1, M2, M4](../plan.md#m1--higher-order-codec-shape).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- Runtime impact + extension fit: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- ADR 186: [docs/architecture docs/adrs/ADR 186 - Codec-dispatched type rendering.md](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
- ADR 204: [docs/architecture docs/adrs/ADR 204 - Operations as TypeScript functions.md](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) — "function is the signature" precedent.
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
