# Design — Authoring ergonomics

**Audience:** pack authors and reviewers concerned with the API surface this project ships. Companion to [codec-interface-and-brand.md](codec-interface-and-brand.md), which covers the underlying mechanism.

**What this doc covers:** the `columnFor` helper, the `jsonCodec` helper, the `storage.types`/`typeRef` model, and three worked before/after examples. Concludes with a sketch of the pack-author guidance that ships at close-out.

---

## Background — fragmented state today

Every parameterized codec exposes a hand-rolled column factory:

```typescript
// pgvector
export function vector<N extends number>(length: N): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: N };
} {
  if (!Number.isInteger(length) || length <= 0) throw new Error('…');
  return { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length } } as const;
}

// hypothetical char(N)
export function char<N extends number>(length: N): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: N };
} {
  if (!Number.isInteger(length) || length <= 0) throw new Error('…');
  return { codecId: 'pg/char@1', nativeType: 'char', typeParams: { length } } as const;
}
```

Two boilerplate layers per codec: validation and descriptor construction. The validation duplicates whatever the codec's `paramsSchema` should already enforce; the descriptor construction is identical line-for-line.

JSON columns suffer the inverse problem: there's no first-class way to project a user's narrowed schema (Arktype / Zod / typebox) into the contract's output type. Pack authors fall back to telling users "type the column manually if you care."

`storage.types` and `typeRef` are not new — they're already part of the contract IR — but they're under-documented and rarely used in the demo. Part of this project's job is to lift them into the authoring story.

---

## The `columnFor` helper

A single helper that subsumes every per-codec factory.

### Signature

```typescript
export function columnFor<C extends Codec>(
  codec: C,
): C extends ParameterizedCodec<infer Id, infer T, infer W, infer Js, infer P, infer B>
  ? <Params extends P>(params: Params) => ColumnTypeDescriptor & { readonly typeParams: Params }
  : ColumnTypeDescriptor;
```

Type-discriminated:

- Parameterized codec → returns a function `(params) => descriptor`.
- Non-parameterized codec → returns the descriptor directly.

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

Validates inline `params` against `paramsSchema` at runtime; throws a structured error on failure. The literal type is preserved through inference.

### What this replaces

- `vector(1536)` → `columnFor(pgVectorCodec)({ length: 1536 })`
- `char(36)` → `columnFor(charCodec)({ length: 36 })`
- `numeric(10, 2)` → `columnFor(numericCodec)({ precision: 10, scale: 2 })`

Pack authors export the codec; users compose with `columnFor`. One helper, one mental model.

### Why a single helper, not "factory per codec"

- One reviewable cross-codec surface.
- Pack authors no longer need to write a factory at all — they ship the codec, users get the helper for free.
- Discoverability: `columnFor(myCodec)` is grep-friendly across schemas.
- The type-discriminated return makes both modes (parameterized and non-) flow through the same call shape.

### Optional sugar

Pack authors who want a named export can re-export `columnFor(pgVectorCodec)` as `vector`:

```typescript
// pgvector exports
export const vector = columnFor(pgVectorCodec);
```

The repo enforces that `vector` is *just* a renamed `columnFor` call — no per-extension validation duplication.

---

## JSON-codec helper

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
//    ^? ColumnTypeDescriptor & {
//         typeParams: { schema: typeof settingsSchema };
//       }
// FieldOutputType resolves to { theme: 'light' | 'dark'; notifications: boolean }
```

### Why this approach

- **Pack-author burden zero.** No JSON Schema → TS converter to maintain. The user's schema library already solves it.
- **Consistent runtime/type story.** The same schema validates wire payloads and types output.
- **Standard Schema is the right interop layer.** Arktype, Zod (4+), Valibot, and others ship Standard Schema implementations. We don't pick a winner.

### What it doesn't cover

- Schemas that aren't Standard Schema. Users must adapt; the framework doesn't ship adapters.
- Schemas whose `InferOutput` produces a recursive type that exceeds TS's depth limit. Out of scope; users hit a separate TS limit.
- Streaming validation / async validation. Out of scope; the existing JSON codec validates synchronously.

---

## `storage.types` vs `typeRef`

These are existing IR concepts; this project leans on them more visibly.

### `storage.types`

A registry on the contract of *named* parameterized type instances:

```typescript
storage.types = {
  Embedding1536: { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length: 1536 } },
  ProductSettings: { codecId: 'pg/json@1', nativeType: 'jsonb', typeParams: { schema: productSchema } },
};
```

Each entry is a `ColumnTypeDescriptor` with a name. The same descriptor a column would carry inline.

### `typeRef`

A column property that points to a `storage.types` entry by name instead of inlining `typeParams`:

```typescript
storage.tables.Document = {
  columns: {
    id: { codecId: 'pg/text@1', nativeType: 'text', primaryKey: true },
    embedding: { typeRef: 'Embedding1536', nullable: true },
  },
};
```

`typeRef` is column-level indirection; `storage.types` is the contract-level registry.

### Why this matters here

- `FieldOutputType` must follow `typeRef` through `storage.types` so a `typeRef` column resolves to the same brand-applied type as an inline-`typeParams` column would. The rewrite in [codec-interface-and-brand.md](codec-interface-and-brand.md#rewriting-the-no-emit-fieldoutputtype) does this.
- `init(params, instanceMeta)` (FR8) is keyed on `storage.types` instances. A column with `typeRef: 'Embedding1536'` shares an instance with every other column referencing `Embedding1536`; its `instance.usedAt` lists them all.
- The pack-author guidance steers users toward `storage.types` for shared types and inline `typeParams` for one-offs. See [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md) for the runtime trade-offs.

### Why we leave both forms

- Inline `typeParams` is the right ergonomic when a column's type isn't reused.
- `storage.types` is the right ergonomic when (a) it is reused, or (b) the codec's `init` does work whose result should be shared (e.g. CipherStash deriving a key once per `(table, column)` set).
- Forcing one over the other would be opinionated to no clear benefit.

---

## Worked example: pgvector

### Before

```typescript
// pgvector codec
const pgVectorCodec = codec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  renderOutputType: (typeParams) => `Vector<${typeParams.length}>`,
  encode: (value: number[]) => `[${value.join(',')}]`,
  decode: (wire: string) => /* parse */,
  meta: { /* … */ },
});

// pgvector exports
export function vector<N extends number>(length: N) {
  if (!Number.isInteger(length) || length <= 0) throw new Error('…');
  return { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length } } as const;
}

// user schema
const Document = {
  columns: {
    id: { codecId: 'pg/text@1', nativeType: 'text' },
    embedding: vector(1536),
  },
};
```

In the no-emit path, `Document.embedding`'s field type resolves to `number[]` — that's the bug.

### After

```typescript
// pgvector codec
export interface VectorBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number }
    ? Vector<N> : never;
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

// pgvector exports
export const vector = columnFor(pgVectorCodec);

// user schema (unchanged at the call site)
const Document = {
  columns: {
    id: { codecId: 'pg/text@1', nativeType: 'text' },
    embedding: vector({ length: 1536 }),
  },
};
```

`Document.embedding` now resolves to `Vector<1536>` in both the emit path (via `renderOutputType`) and the no-emit path (via `Apply<VectorBrand, { length: 1536 }>`). The user's call site is one method-call shape away from before; the migration is a single replace.

If the user prefers the old positional `vector(1536)` ergonomic, the pack can wrap:

```typescript
export const vector = <N extends number>(length: N) => columnFor(pgVectorCodec)({ length });
```

…with the validation still flowing through `paramsSchema`.

---

## Worked example: hypothetical `char(N)` codec

A pack author adds Postgres `char(N)` support.

```typescript
// codec
export interface CharBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number }
    ? Char<N> : never;
}

export type Char<N extends number = number> = string & { readonly __charLength?: N };

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

// helper export
export const char = columnFor(charCodec);

// user schema
const User = {
  columns: {
    id: char({ length: 36 }),
    // FieldOutputType resolves to Char<36>
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
  pricing: { currency: "'USD' | 'EUR'", amount: 'number' },
});

const Product = {
  columns: {
    id: { codecId: 'pg/text@1', nativeType: 'text' },
    settings: columnFor(jsonCodec)({ schema: ProductSettings }),
  },
};

// FieldOutputType resolves Product.settings to:
// {
//   visibility: 'public' | 'private';
//   pricing: { currency: 'USD' | 'EUR'; amount: number };
// }
```

The same schema:

- Validates wire payloads at runtime (the JSON codec already does this; M3.2 just threads the brand).
- Types the column at the no-emit type level.
- Drives the emitted `contract.d.ts` at the emit path (the `renderOutputType` for `jsonCodec` calls into the schema's TS-source serialization, if any; the user can override).

For schemas Standard Schema can't render to a TS source string for the emit path, the pack author's `renderOutputType` returns `'unknown'` and the no-emit path remains the precise inference path. This trade-off lives in the pack-author guidance.

---

## Pack-author guidance preview

The README section that ships in M6 (close-out) covers, in order:

1. **Decide if your codec is parameterized.** No params? Plain `codec({…})`. Params? `parameterizedCodec({…})`.
2. **Define the brand next to the codec.** Use the `this['Input']` HKT idiom; one cast.
3. **Pick `paramsSchema`.** Any Standard Schema (Arktype recommended).
4. **Implement `renderOutputType`.** A pure function from `params` to a TS source string for the emit path.
5. **Export `columnFor(yourCodec)`** (optionally aliased) as your column-author surface.
6. **For JSON-shaped columns**, prefer `jsonCodec` over rolling your own.
7. **Cross-cutting**: when in doubt, use `storage.types` for shared types; inline `typeParams` for one-offs.

A short section on `init`:

8. **`init` is optional and runs once per `storage.types` instance.** Use it when your codec needs to derive per-instance state from `params` and the `(table, column)` context (e.g. an encryption key, a precompiled regex). Don't rely on the runtime contract until [TML-2330](https://linear.app/prisma-company/issue/TML-2330) lands; for now, `init` is a declared shape.

---

## Cross-references

- Spec: [spec.md FR3, FR4](../spec.md#requirements).
- Plan: [plan.md M3, M4](../plan.md#m3--columnfor-and-jsoncodec-authoring-helpers).
- Mechanism details: [codec-interface-and-brand.md](codec-interface-and-brand.md).
- Runtime contract for `init` and `storage.types`: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
