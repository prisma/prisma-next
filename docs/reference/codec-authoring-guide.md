# Codec authoring guide

This guide describes the canonical authoring shape for codecs in Prisma Next: **class-based codecs and descriptors** (`CodecImpl`, `CodecDescriptorImpl`), per-codec column helpers, and `satisfies` for compile-time wiring. The design rationale and the broader codec model live in [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md); this document is the practical "how to write a codec" reference for contributors.

## At a glance

A codec is **three artifacts**:

1. A **codec class** that extends `CodecImpl<Id, TTraits, TWire, TInput>` and implements all four conversion methods: `encode`, `decode`, `encodeJson`, and `decodeJson`.
2. A **descriptor class** that extends `CodecDescriptorImpl<P>` and declares the codec id, traits, target types, params schema, and the curried factory that materializes codec instances.
3. A **per-codec column helper function** that calls `descriptor.factory(...)` directly and packages the result into a `ColumnSpec` via the framework-supplied `column(...)` packager. The helper carries a `satisfies ColumnHelperFor<D>` clause that ties it to its descriptor at compile time.

The framework imports live at `@prisma-next/framework-components/codec`:

- `CodecImpl<Id, TTraits, TWire, TInput>` — abstract codec base class.
- `CodecDescriptorImpl<P>` — abstract descriptor base class.
- `ColumnHelperFor<D>` / `ColumnHelperForStrict<D>` — `satisfies` shapes for per-codec helpers.
- `column(codecFactory, codecId, typeParams, nativeType)` — column-spec packager (`nativeType` is the database spelling for migrations and contract meta).
- `voidParamsSchema` — Standard Schema validator for `P = void` (non-parameterized codecs).
- `Codec<...>`, `CodecDescriptor<P>`, `AnyCodecDescriptor` — consumer-facing interfaces (consumers depend on these; authors extend the `*Impl` classes).

SQL codecs use the same framework `CodecImpl` base. Their `encodeJson` and `decodeJson` methods must use the exact scalar representation produced by the corresponding database inside JSON values. SQL include decoding calls `decodeJson`; `decode` remains responsible for the driver's ordinary column wire value. This distinction is essential for types such as Postgres `bytea` and extension-defined types whose database JSON representation differs from their normal driver representation.

When a target has no native JSON facility, its codecs may choose any JSON-safe representation for contract values. That representation must be stable, and `encodeJson` and `decodeJson` must be mutually consistent so an encoded contract value decodes to the original application value.

## Three case studies

The same three artifacts express the full spectrum: non-parameterized, parameterized with literal preservation, and parameterized with a typed schema.

### Case 1 — Non-parameterized codec (`pg/text@1`)

```ts
import type { JsonValue } from '@prisma-next/contract/types';
import {
  type CodecCallContext,
  type CodecInstanceContext,
  CodecDescriptorImpl,
  CodecImpl,
  type ColumnHelperFor,
  column,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';

class PgTextCodec extends CodecImpl<
  'pg/text@1',
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext) { return value; }
  async decode(wire: string, _ctx: CodecCallContext) { return wire; }
  encodeJson(value: string) { return value; }
  decodeJson(json: JsonValue) {
    if (typeof json !== 'string') {
      throw new TypeError('Expected a string JSON value');
    }
    return json;
  }
}

class PgTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'pg/text@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    const shared = new PgTextCodec(this);
    return () => shared;
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const text = () =>
  column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined, 'text');
text satisfies ColumnHelperFor<PgTextDescriptor>;
```

The factory is **constant**: every call returns the same shared codec instance. The runtime relies on this contract — non-parameterized columns sharing a codec id share one resolved codec without explicit caching.

### Case 2 — Parameterized codec with literal preservation (`pg/vector@1`)

```ts
import { type } from 'arktype';

class VectorCodec<N extends number> extends CodecImpl<
  'pg/vector@1',
  readonly ['equality'],
  string,
  Vector<N>
> {
  constructor(descriptor: PgVectorDescriptor, readonly dimension: N) {
    super(descriptor);
  }
  async encode(value: Vector<N>, _ctx: CodecCallContext) {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return parseVector(wire) as Vector<N>;
  }
}

class PgVectorDescriptor extends CodecDescriptorImpl<{ readonly length: number }> {
  override readonly codecId = 'pg/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = type({ length: 'number > 0' });
  override renderOutputType({ length }: { length: number }) { return `Vector<${length}>`; }
  override factory<N extends number>(
    params: { readonly length: N },
  ): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return (ctx) => new VectorCodec<N>(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

export const vector = <N extends number>(length: N) =>
  column(
    pgVectorDescriptor.factory({ length }),
    pgVectorDescriptor.codecId,
    { length },
    'vector',
  );
vector satisfies ColumnHelperFor<PgVectorDescriptor>;
```

The class-level params type is `{ readonly length: number }` (widest bound). The **method-level generic** `<N extends number>` on `factory` is what preserves the literal at the call site: when `vector(1536)` calls `pgVectorDescriptor.factory({ length: 1536 })` *directly*, TypeScript binds `N=1536`. The literal flows through `column(...)`'s generics into the column spec, into the contract type, and into `contract.d.ts`.

This is the **load-bearing variance pattern**: method generics on the descriptor's factory are preserved by direct invocation inside the per-codec helper, not by structural extraction at a polymorphic helper. A polymorphic `column<P, R>(descriptor, params)` helper that tried to extract `R` from the descriptor's `factory` would lose the literal — TypeScript instantiates method generics to their constraint at every form of structural extraction (structural match, indexed access, `Parameters` / `ReturnType`, etc.).

### Case 3 — Parameterized codec with typed schema (`arktype/json@1`)

The schema's TypeScript-level inferred type `S['infer']` is only available at the column-author site (where the user passes their typed schema), not at the descriptor's factory site (where only the serialized IR is available). This drives a slightly richer shape than Case 2:

```ts
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';

class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  'arktype/json@1',
  readonly ['equality'],
  string,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) { super(descriptor); }
  async encode(value: TInferred, _ctx: CodecCallContext) {
    return serializeToJsonSafe(this.schema, value).wire;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return validateSchema<TInferred>(this.schema, JSON.parse(wire));
  }
}

class ArktypeJsonDescriptor extends CodecDescriptorImpl<ArktypeJsonTypeParams> {
  override readonly codecId = 'arktype/json@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['jsonb'] as const;
  override readonly paramsSchema = type({
    expression: 'string',
    jsonIr: 'object',
  }) satisfies StandardSchemaV1<ArktypeJsonTypeParams>;
  override renderOutputType(params: ArktypeJsonTypeParams) { return params.expression; }
  override factory(
    params: ArktypeJsonTypeParams,
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown> {
    const schema = rehydrateSchema(params.jsonIr);
    return () => new ArktypeJsonCodecClass<unknown>(this, schema);
  }
}

export const arktypeJsonDescriptor = new ArktypeJsonDescriptor();

export function arktypeJsonColumn<S extends Type<unknown>>(
  schema: S,
): ColumnSpec<ArktypeJsonCodecClass<S['infer']>, ArktypeJsonTypeParams> {
  // Eager serialization captures `expression` (emit-path) and `jsonIr` (runtime rehydration) at the column-author site.
  const params: ArktypeJsonTypeParams = { expression: schema.expression, jsonIr: schema.json };
  return column(
    (_ctx) => new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptor, schema),
    arktypeJsonDescriptor.codecId,
    params,
    'jsonb',
  );
}
arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
```

Two things to note:

1. The descriptor's factory return is `ArktypeJsonCodecClass<unknown>` (the descriptor only sees IR — `S` is erased). The runtime path through `descriptor.factory(params)` always exists (e.g. for `validateContract` re-materialization); it just loses the typed inferred shape.
2. The column helper bypasses `descriptor.factory(...)` and constructs the typed codec directly so `S['infer']` flows through the column spec into the contract type. It satisfies `ColumnHelperFor<D>` (coarse) but not `ColumnHelperForStrict<D>` — the descriptor's factory return is `ArktypeJsonCodecClass<unknown>` while the helper produces `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is invariant. Negative type tests cover the literal-preservation property the strict variant would otherwise enforce.

JSON-Schema validation lives **inside `decode`**: the rehydrated schema is closure-captured by the codec instance, and `decode` calls into it synchronously. There is no parallel validator registry — the framework deleted `JsonSchemaValidatorRegistry` when unified descriptors and inline decode validation replaced the parallel registry.

## `satisfies` discipline

The framework exports two helper-shape constraints:

- `ColumnHelperFor<D>` — checks the helper returns a `ColumnSpec` whose typeParams shape matches `Parameters<D['factory']>[0]`. Catches wiring the wrong descriptor's factory in by typeParams shape; doesn't catch literal-preservation violations (those are covered by negative type tests).
- `ColumnHelperForStrict<D>` — also checks the helper's promised codec type matches `ReturnType<D['factory']>`. Use this when the codec's resolved type is well-defined (most cases). The strict form fails for helpers like `arktypeJsonColumn` whose typed return is more specific than the descriptor's factory return; in that case use the coarse form and rely on `expectTypeOf` tests for the literal-preservation property.

Both are exported from `@prisma-next/framework-components/codec`.

## Aliases

Aliasing a codec under a new id (e.g. Postgres's `pgCharDescriptor` aliasing the SQL-base `sqlCharDescriptor`) is a **descriptor-level** operation, not an instance-level one. There is no `aliasCodec` helper: aliases are expressed as plain class inheritance from the base descriptor with the alias's metadata overridden.

```ts
// SQL base — relational-core/src/ast/sql-codecs.ts
class SqlCharDescriptor extends CodecDescriptorImpl<LengthParams> { /* … */ }
export const sqlCharDescriptor = new SqlCharDescriptor();

// Postgres alias — target-postgres/src/core/codecs.ts
class PgCharDescriptor extends SqlCharDescriptor {
  override readonly codecId = 'pg/char@1';
  override readonly targetTypes = ['char'] as const;
}
export const pgCharDescriptor = new PgCharDescriptor();
```

Inherited overrides do the heavy lifting: the alias inherits `paramsSchema`, `traits`, and `factory` from the base. Because `CodecImpl.id` proxies through `this.descriptor.codecId`, instances produced by `pgCharDescriptor.factory(params)(ctx)` automatically report the alias's id without prototype-stripping (the legacy `{ ...base, id }` spread pattern lost the prototype on class-instance bases — descriptor-class inheritance never spreads, so the bug is structurally avoided).

See [packages/3-targets/3-targets/postgres/src/core/codecs.ts](../../packages/3-targets/3-targets/postgres/src/core/codecs.ts) (`pgCharDescriptor`, `pgVarcharDescriptor`) for the canonical pattern.

## Heterogeneous storage at the runtime layer

The framework's descriptor registry is keyed by `codecId: string` and stores type-erased descriptor instances. The canonical erasure type is `AnyCodecDescriptor` (defined in `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`):

```ts
interface CodecDescriptorRegistry {
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  values(): IterableIterator<CodecDescriptor<unknown>>;
  byTargetType(targetType: string): readonly CodecDescriptor<unknown>[];
}
```

Registries are built from flat descriptor lists (see `buildCodecDescriptorRegistry` in `@prisma-next/sql-relational-core`); there is no imperative `register` on the public surface.

`CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly), so `CodecDescriptor<unknown>` is **not** assignable from concrete `CodecDescriptor<SpecificParams>` subclasses — the `<unknown>` shape would force `as` casts at every register/retrieve boundary. `AnyCodecDescriptor` is the only erasure form that admits cast-free heterogeneous storage.

Per-codec helpers don't pass through the registry — they're imported directly by extension authors and column-defining sites. The registry exists for runtime lookup (by codec id string), where types are already erased.

## Why classes work for this design

The class hierarchy isn't load-bearing for variance preservation (per-codec helpers' direct calls do that work). It's load-bearing for **structure**:

1. **Codec instance ↔ descriptor reference is structural.** The abstract `CodecImpl` constructor takes a `descriptor: AnyCodecDescriptor`; concrete codec subclasses pass it via `super(descriptor)`. `codec.id` proxies through this reference. Aliases work for free: an alias descriptor produces a codec whose `descriptor` points to the alias, so `codec.id` reports the alias's `codecId` automatically.
2. **Subclass-based authoring is uniform across the codec spectrum.** Non-parameterized, parameterized, schema-typed, alias — all four shapes are expressed as `class X extends CodecDescriptorImpl<...>` with overrides on the abstract members. The variance behavior is identical across all four: the per-codec helper handles literal preservation via direct calls; the descriptor class declares the shape.

## Reference implementations in the repo

- **Non-parameterized base codecs** (text, int, float, bool, etc.): `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`.
- **Postgres adapter codecs and aliases**: `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
- **SQLite adapter codecs**: `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`.
- **Parameterized codec with literal preservation** (pgvector): `packages/3-extensions/pgvector/src/core/codecs.ts`.
- **Parameterized codec with typed schema** (arktype-json): `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`.

## Pitfalls

- **`override` discipline.** With `noImplicitOverride`, every concrete-subclass member that touches an inherited member must carry `override`. Forgetting it surfaces as a typecheck error.
- **Don't widen the factory return at the descriptor.** Concrete descriptors should declare their factory's typed return (`(ctx) => VectorCodec<N>`, not `(ctx) => Codec<...>`). The widened return loses literal preservation at consumer sites.
- **Don't extract codec types via `Parameters` / `ReturnType` of the descriptor's `factory`.** TypeScript widens method generics to their constraint in those forms. Use the per-codec helper's typed return (`ColumnSpec<R, P>`) and project with `R extends Codec<any, any, any, infer T> ? T : never`.
- **Don't reach through the codec instance for metadata.** The runtime `Codec` instance is narrow (id + four conversion methods). Read traits / target types / meta from `descriptor` (e.g. `context.codecDescriptors.descriptorFor(codecId).traits`).

## See also

- [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — design rationale and how the codec composes across authoring, emit, and runtime dispatch.
- [ADR 204 — Single-Path Async Codec Runtime](../architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — `encode` / `decode` are uniformly Promise-returning at the public boundary.
- [ADR 207 — Codec call context](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the `CodecCallContext` (per-call signal + family-extended column metadata) threaded into every encode/decode invocation.
