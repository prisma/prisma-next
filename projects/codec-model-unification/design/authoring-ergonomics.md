# Design — Authoring ergonomics

**Audience:** pack authors and reviewers concerned with the API surface this project ships. Companion to [codec-interface-and-brand.md](codec-interface-and-brand.md), which covers the underlying mechanism.

**What this doc covers:** the `columnFor` helper, the `jsonCodec` helper, the `storage.types`/`typeRef` model with worked examples, and the pack-author guidance that ships at close-out.

---

## Decision

Ship two helpers and codify the existing `storage.types` / `typeRef` IR concepts as the authoring story:

```typescript
// One factory replaces every per-codec column factory.
columnFor(textCodec)                              // → ColumnTypeDescriptor
columnFor(pgVectorCodec)({ length: 1536 })        // → ColumnTypeDescriptor & { typeParams: { length: 1536 } }

// JSON columns get schema-driven type inference for free.
columnFor(jsonCodec)({ schema: ProductSettings }) // → ColumnTypeDescriptor with brand projecting InferOutput<ProductSettings>
```

`columnFor` is type-discriminated on whether the codec extends `ParameterizedCodec`. Pack authors expose their codec; users compose with `columnFor`. Existing per-codec factories (`vector(N)`, `char(N)`, `numeric(p, s)`) become thin re-exports of `columnFor(codec)` or vanish.

`jsonCodec(schema)` is a `ParameterizedCodec` whose `Brand` projects `StandardSchemaV1.InferOutput<S>` as the column output type. We don't write a JSON-Schema-to-TS converter; the user's schema library (Arktype, Zod, Valibot, …) already does it via Standard Schema.

`storage.types` (named instances) and `typeRef` (column-level reference) become the authoring affordance for cross-column sharing. Unchanged at the IR level; surfaced more visibly in pack-author docs.

This satisfies [AC-3](../spec.md#ac-3-columnfor-and-jsoncodec-ship-the-documented-surface) and underwrites [AC-2](../spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly) (JSON column case) and [AC-4](../spec.md#ac-4-existing-parameterized-codecs-migrated) (per-codec migrations are one-line).

---

## The `columnFor` helper

### Signature

```typescript
export function columnFor<C extends Codec>(
  codec: C,
): C extends ParameterizedCodec<infer Id, infer T, infer W, infer Js, infer P, infer B>
  ? <Params extends P>(params: Params) => ColumnTypeDescriptor & { readonly typeParams: Params }
  : ColumnTypeDescriptor;
```

Type-discriminated:

- Parameterized codec → `(params) => descriptor` (literal-preserving).
- Non-parameterized codec → descriptor directly.

### Behavior

```typescript
import { columnFor } from '@prisma-next/contract-ts';
import { pgVectorCodec } from '@prisma-next/pgvector';
import { textCodec } from '@prisma-next/postgres-core';

const vectorCol = columnFor(pgVectorCodec)({ length: 1536 });
//    ^? ColumnTypeDescriptor & { readonly typeParams: { readonly length: 1536 } }

const textCol = columnFor(textCodec);
//    ^? ColumnTypeDescriptor
```

Inline `params` are validated against the codec's `paramsSchema` at runtime; throws a structured error on failure. Literal types are preserved through inference.

### What this replaces

- `vector(1536)` → `columnFor(pgVectorCodec)({ length: 1536 })`
- `char(36)` → `columnFor(charCodec)({ length: 36 })`
- `numeric(10, 2)` → `columnFor(numericCodec)({ precision: 10, scale: 2 })`

Pack authors export the codec; users compose with `columnFor`. One helper, one mental model.

### Why a single helper, not "factory per codec"

- One reviewable cross-codec surface.
- Pack authors stop writing factories at all — they ship the codec, users get the helper for free.
- Discoverability: `columnFor(myCodec)` is grep-friendly across schemas.
- The type-discriminated return makes both modes (parameterized and non-) flow through the same call shape.

### Optional sugar

Pack authors who want a named export can re-export `columnFor(codec)` under a friendly alias:

```typescript
// pgvector exports
export const vector = columnFor(pgVectorCodec);
```

…or wrap to preserve a positional ergonomic:

```typescript
export const vector = <N extends number>(length: N) => columnFor(pgVectorCodec)({ length });
```

The repo enforces that named factories are *just* renamed `columnFor` calls — no duplicated validation.

---

## `jsonCodec` helper

The JSON-with-schema case is special: the user supplies the schema, and the schema is *both* the runtime validator and the source of truth for the output type.

### Signature

```typescript
import type { StandardSchemaV1 } from '@standard-schema/spec';

export const jsonCodec: ParameterizedCodec<
  'pg/json@1',
  ['equality'],
  string,
  unknown,
  { readonly schema: StandardSchemaV1 },
  JsonCodecBrand
>;

interface JsonCodecBrand extends CodecBrand<{ readonly schema: StandardSchemaV1 }> {
  readonly Input: { readonly schema: StandardSchemaV1 };
  readonly Output: this['Input'] extends { readonly schema: infer S extends StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<S>
    : JsonValue;
}
```

The brand projects the user-supplied schema's inferred type as the output. `JsonValue` is the unconstrained fallback when no schema is provided.

### Usage

```typescript
import { type } from 'arktype';
import { columnFor, jsonCodec } from '@prisma-next/postgres-core';

const settingsSchema = type({ theme: "'light' | 'dark'", notifications: 'boolean' });

const settingsCol = columnFor(jsonCodec)({ schema: settingsSchema });
// FieldOutputType resolves to { theme: 'light' | 'dark'; notifications: boolean }
```

### Why this approach

- **Pack-author burden zero.** No JSON-Schema → TS converter to maintain.
- **Consistent runtime/type story.** The same schema validates wire payloads and types output.
- **Standard Schema is the right interop layer.** Arktype, Zod (4+), Valibot, and others ship Standard Schema implementations; we don't pick a winner.

### What it doesn't cover

- Schemas that aren't Standard Schema. Users must adapt.
- Schemas whose `InferOutput` produces a recursive type that exceeds TS's depth limit. Out of scope (a TS limitation users hit independently of this project).
- Streaming or async validation. Out of scope (the existing JSON codec validates synchronously).

For schemas Standard Schema can't render to a TS source string for the emit path, the pack author's `renderOutputType` returns `'unknown'`; the no-emit path keeps the precise inference. This trade-off lives in the pack-author guidance.

---

## `storage.types` and `typeRef`

Existing IR concepts; this project leans on them more visibly.

### `storage.types`

A registry on the contract of *named* parameterized type instances:

```typescript
storage.types = {
  Embedding1536:    { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length: 1536 } },
  ProductSettings:  { codecId: 'pg/json@1',   nativeType: 'jsonb',  typeParams: { schema: productSchema } },
};
```

Each entry is a `ColumnTypeDescriptor` with a name — the same shape a column would carry inline.

### `typeRef`

A column property that points to a `storage.types` entry by name instead of inlining `typeParams`:

```typescript
storage.tables.Document = {
  columns: {
    id:        { codecId: 'pg/text@1', nativeType: 'text', primaryKey: true },
    embedding: { typeRef: 'Embedding1536', nullable: true },
  },
};
```

`typeRef` is column-level indirection; `storage.types` is the contract-level registry.

### Why this matters here

- `FieldOutputType` follows `typeRef` through `storage.types` so a `typeRef` column resolves to the same brand-applied type as an inline-`typeParams` column would. Mechanism: [codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype](codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype).
- `init(params, instanceMeta)` is keyed on `storage.types` instances. A column with `typeRef: 'Embedding1536'` shares an instance with every other column referencing `Embedding1536`; `instance.usedAt` lists them all.
- Pack-author guidance steers users toward `storage.types` for shared types and inline `typeParams` for one-offs. Trade-offs: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).

### Why we keep both forms

- Inline `typeParams`: right ergonomic when a column's type isn't reused.
- `storage.types`: right ergonomic when the type *is* reused, or when the codec's `init` does work whose result should be shared (e.g. CipherStash deriving one key per `(table, column)` set).

Forcing one over the other would be opinionated to no clear benefit.

---

## Worked example: pgvector

### Before

```typescript
// codec
const pgVectorCodec = codec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  renderOutputType: (typeParams) => `Vector<${typeParams.length}>`,
  encode: (value: number[]) => `[${value.join(',')}]`,
  decode: (wire: string) => /* parse */,
  meta: { /* … */ },
});

// hand-rolled factory
export function vector<N extends number>(length: N) {
  if (!Number.isInteger(length) || length <= 0) throw new Error('…');
  return { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length } } as const;
}

// user schema
const Document = {
  columns: {
    id:        { codecId: 'pg/text@1', nativeType: 'text' },
    embedding: vector(1536),
  },
};
```

In the no-emit path, `Document.embedding`'s field type resolves to `number[]` — the bug.

### After

```typescript
// codec + co-located brand
export interface VectorBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number } ? Vector<N> : never;
}

export const pgVectorCodec = parameterizedCodec({
  id: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  encode: (value: number[]) => `[${value.join(',')}]`,
  decode: (wire: string) => /* parse */,
  Brand: undefined as unknown as VectorBrand,
  meta: { /* … */ },
});

// factory replaced with columnFor
export const vector = columnFor(pgVectorCodec);

// user schema
const Document = {
  columns: {
    id:        { codecId: 'pg/text@1', nativeType: 'text' },
    embedding: vector({ length: 1536 }),
  },
};
```

`Document.embedding` resolves to `Vector<1536>` in both the emit path (via `renderOutputType`) and the no-emit path (via `Apply<VectorBrand, { length: 1536 }>`). Migration is a single replace at the user's call site.

---

## Worked example: hypothetical `char(N)` codec

A pack author adds Postgres `char(N)` support.

```typescript
export type Char<N extends number = number> = string & { readonly __charLength?: N };

export interface CharBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number } ? Char<N> : never;
}

export const charCodec = parameterizedCodec({
  id: 'pg/char@1',
  targetTypes: ['char'],
  traits: ['equality', 'orderable'],
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Char<${length}>`,
  encode: (s: string) => s,
  decode: (s: string) => s,
  Brand: undefined as unknown as CharBrand,
});

export const char = columnFor(charCodec);

// user schema
const User = {
  columns: {
    id: char({ length: 36 }),  // FieldOutputType resolves to Char<36>
  },
};
```

The pack ships ~25 lines and gets correct emit-path *and* no-emit-path types, runtime validation of `params`, and the `columnFor` ergonomic for free.

---

## Worked example: JSON column with Arktype schema

```typescript
import { type } from 'arktype';
import { columnFor, jsonCodec } from '@prisma-next/postgres-core';

const ProductSettings = type({
  visibility: "'public' | 'private'",
  pricing:    { currency: "'USD' | 'EUR'", amount: 'number' },
});

const Product = {
  columns: {
    id:       { codecId: 'pg/text@1', nativeType: 'text' },
    settings: columnFor(jsonCodec)({ schema: ProductSettings }),
  },
};

// FieldOutputType resolves Product.settings to:
//   { visibility: 'public' | 'private'; pricing: { currency: 'USD' | 'EUR'; amount: number } }
```

The same schema:

- Validates wire payloads at runtime.
- Types the column at the no-emit type level.
- Drives the emitted `contract.d.ts` at the emit path (the `renderOutputType` for `jsonCodec` calls into the schema's TS-source serialization, if any).

---

## Pack-author guidance preview

The README section that ships in M6 (close-out) covers, in order:

1. **Decide if your codec is parameterized.** No params? Plain `codec({…})`. Params? `parameterizedCodec({…})`.
2. **Define the brand next to the codec** using the `this['Input']` HKT idiom; one cast.
3. **Pick `paramsSchema`.** Any Standard Schema (Arktype recommended).
4. **Implement `renderOutputType`.** Pure function from `params` to a TS source string for the emit path.
5. **Export `columnFor(yourCodec)`** (optionally aliased) as your column-author surface.
6. **For JSON-shaped columns**, prefer `jsonCodec` over rolling your own.
7. **Cross-cutting**: use `storage.types` for shared types; inline `typeParams` for one-offs.
8. **`init` is optional and runs once per `storage.types` instance.** Use it when your codec needs to derive per-instance state from `params` and the `(table, column)` context (encryption key, precompiled regex, …). Don't rely on the runtime contract until [TML-2330](https://linear.app/prisma-company/issue/TML-2330) lands; the signature is declared but the runtime side is deferred.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §4, §5](../spec.md#how-it-works), [AC-3](../spec.md#ac-3-columnfor-and-jsoncodec-ship-the-documented-surface).
- Plan: [plan.md M3, M4](../plan.md#m3--columnfor-and-jsoncodec-authoring-helpers).
- Mechanism details: [codec-interface-and-brand.md](codec-interface-and-brand.md).
- Runtime contract for `init` and `storage.types`: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
