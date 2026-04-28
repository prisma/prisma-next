# Design — Authoring ergonomics

**Audience:** pack authors and reviewers concerned with the API surface this project ships. Companion to [higher-order-codecs.md](higher-order-codecs.md), which covers the underlying mechanism.

**What this doc covers:** the pack-author surface (one curried factory + one descriptor per parameterized codec), the JSON factory (`json(schema)`) we ship as the framework's default, the `storage.types`/`typeRef` model, how `ctx` is supplied at the column site, and end-to-end **case studies** ([Case V — Vector](#case-v--vector-literal-typed-numeric-param), [Case J — JSON-with-schema](#case-j--json-with-schema)) drawn from [spec.md § Cases that pin the design](../spec.md#cases-that-pin-the-design). The third case (CipherStash, [Case C](runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption)) lives in the runtime-contract doc because it's primarily about runtime materialization.

---

## Decision

Pack authors ship two exports per parameterized codec:

```typescript
// 1. The curried factory function — what users call at the column site.
export function vector<N extends number>(length: N): (ctx: Ctx) =>
  Codec<'pg/vector@1', ['equality'], string, Vector<N>> { … }

// 2. The descriptor — what registers with the framework.
export const pgVectorCodec: ParameterizedCodecDescriptor<{ length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: vector,
};
```

Users compose with the function directly:

```typescript
.column('embedding', vector(1536))                          // inline params
.column('settings', json(productSchema))                    // schema-typed JSON
storage.types: { Embedding1536: vector(1536) }              // shared instance
.column('embedding', { typeRef: 'Embedding1536' })          // reference to shared
```

The contract-authoring builder supplies `ctx` to the partial application; users never see it.

`columnFor` and per-codec column-descriptor factories (today's `vectorColumn`, `vector(N)` returning a generic descriptor) **go away** — the typed factory replaces them. JSON columns regain schema-driven type inference through `json(schema)` (Restoration: this worked before the no-emit path was introduced).

This satisfies [AC-1](../spec.md#ac-1-higher-order-codec-factories-type-resolve-correctly), [AC-3](../spec.md#ac-3-authoring-side-ctx-is-supplied-to-factories), [AC-5](../spec.md#ac-5-json-factory-ships) and underwrites [AC-4](../spec.md#ac-4-existing-parameterized-codecs-migrated). Driving cases: [V](../spec.md#case-v--vector-literal-typed-numeric-param), [J](../spec.md#case-j--json-with-schema).

---

## How `ctx` is supplied

*Driving case:* C (V, J ignore `ctx`).

The user's column expression is the partially applied factory:

```typescript
.column('embedding', vector(1536))
//                   ^^^^^^^^^^^^^
//                   typed: (ctx: Ctx) => Codec<…, Vector<1536>>
```

The contract-authoring builder, walking the model, computes:

```typescript
ctx = {
  name:   '<anon:Document.embedding>',
  usedAt: [{ table: 'Document', column: 'embedding' }],
};
```

…and applies it to the partial:

```typescript
const codec = vector(1536)(ctx);
```

The codec's data part (`id`, `typeParams`) is captured into the column descriptor in the contract IR. The closure functions (`encode`, `decode`) are discarded; they get rebuilt at runtime load time by calling `descriptor.factory(typeParams)(ctx)` again.

### `storage.types` aggregation

Named instances declared in `storage.types` get aggregated `usedAt`:

```typescript
storage.types: {
  Embedding1536: vector(1536),
}
storage.tables: {
  Document: { columns: { embedding: { typeRef: 'Embedding1536' } } },
  Page:     { columns: { embedding: { typeRef: 'Embedding1536' } } },
}
```

The builder collects every column referencing `'Embedding1536'`, then calls:

```typescript
ctx = {
  name:   'Embedding1536',
  usedAt: [
    { table: 'Document', column: 'embedding' },
    { table: 'Page',     column: 'embedding' },
  ],
};
const codec = vector(1536)(ctx);
```

For Vector this changes nothing (`ctx` is unused). For CipherStash, this is what enables a *single* key derivation shared across both columns. Detail: [runtime-contract-and-compatibility.md#case-c](runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption).

### Why partial application instead of an explicit ctx parameter

Users don't have `ctx`. Forcing them to write `vector(1536, ctx)` would mean either:

- Plumbing `ctx` through the contract-authoring builder's user-facing API (`.column('embedding', ({ ctx }) => vector(1536, ctx))`) — verbose, clutters every column.
- Defining `ctx` as a hidden global the function can read — implicit, brittle.

Currying keeps the user's call short (`vector(1536)`) and the framework's plumbing local to the builder.

---

## JSON factory

The JSON-with-schema case is special only in that the framework ships *one* parameterized codec that's used by every JSON column. Pack authors don't need to ship their own.

### Signature

```typescript
import type { StandardSchemaV1 } from '@standard-schema/spec';

export function json<S extends StandardSchemaV1>(schema: S): (ctx: Ctx) =>
  Codec<'pg/json@1', ['equality'], string, StandardSchemaV1.InferOutput<S>> { … }

export const pgJsonCodec: ParameterizedCodecDescriptor<{ schema: StandardSchemaV1 }> = {
  codecId: 'pg/json@1',
  paramsSchema: /* a Standard Schema that validates schema-presence */,
  renderOutputType: /* see below */,
  factory: json,
};
```

The factory body uses the same schema for runtime validation:

```typescript
return (ctx) => ({
  id: 'pg/json@1',
  // …
  decode: (wire: string) => {
    const parsed = JSON.parse(wire);
    const validated = schema['~standard'].validate(parsed);
    if (validated.issues) throw new ValidationError(validated.issues);
    return validated.value as StandardSchemaV1.InferOutput<S>;
  },
  encode: (value) => JSON.stringify(value),
  // …
});
```

### Usage

```typescript
import { type } from 'arktype';
import { json } from '@prisma-next/postgres-core';

const ProductSettings = type({
  visibility: "'public' | 'private'",
  pricing:    { currency: "'USD' | 'EUR'", amount: 'number' },
});

const Product = {
  columns: {
    id:       textCodec,
    settings: json(ProductSettings),                          // resolved JS type ↓
    //        ^? (ctx) => Codec<…, { visibility: 'public' | 'private'; pricing: { currency: 'USD' | 'EUR'; amount: number } }>
  },
};
```

The same schema:

- Validates wire payloads at runtime (in `decode`).
- Types the column at the no-emit type level (via the factory's TS return).
- Drives `contract.d.ts` via the descriptor's `renderOutputType` (which calls into the schema's TS-source serialization, if available, or returns `'unknown'` as a fallback).

### What the JSON factory doesn't cover

- Schemas that aren't Standard Schema. Users must adapt.
- Schemas whose `InferOutput` produces a recursive type that exceeds TS's depth limit. Out of scope (a TS limitation users hit independently of this project).
- Streaming or async validation. Out of scope (the existing JSON codec validates synchronously).

For schemas Standard Schema can't render to a TS source string for the emit path, `renderOutputType` returns `'unknown'`; the no-emit path keeps the precise inference. This trade-off lives in the pack-author guidance.

---

## `storage.types` and `typeRef`

Existing IR concepts; this project leans on them more visibly.

### `storage.types`

A registry on the contract of *named* parameterized type instances:

```typescript
storage.types = {
  Embedding1536:    vector(1536),
  ProductSettings:  json(productSchema),
};
```

Each entry is a partially applied factory; the contract IR stores `{ codecId, typeParams }` after applying `ctx`. Detail: [how-ctx-is-supplied](#how-ctx-is-supplied).

### `typeRef`

A column property that points to a `storage.types` entry by name instead of inlining params:

```typescript
storage.tables.Document = {
  columns: {
    id:        textCodec,
    embedding: { typeRef: 'Embedding1536', nullable: true },
  },
};
```

`typeRef` is column-level indirection; `storage.types` is the contract-level registry.

### Why this matters here

- `FieldOutputType` follows `typeRef` through `storage.types` so a `typeRef` column resolves to the same factory-returned type as an inline-`vector(...)` column would. Mechanism: [higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype](higher-order-codecs.md#rewriting-the-no-emit-fieldoutputtype).
- `ctx.usedAt` for a named instance lists every column referencing `Embedding1536`; for an anonymous instance it's a single entry. CipherStash uses this to derive one column-scoped key per `storage.types` entry.

### Why we keep both forms

- Inline factory call: right ergonomic when a column's type isn't reused.
- `storage.types`: right ergonomic when the type *is* reused, or when the codec's factory does work whose result should be shared (e.g. CipherStash deriving one key for `(table, column)` pairs).

Forcing one over the other would be opinionated to no clear benefit.

---

## Why not a shared `columnFor` helper

An earlier iteration of this project shipped a single `columnFor(codec)` helper that turned any codec into a column-descriptor factory, type-discriminated on whether the codec was parameterized:

```typescript
columnFor(textCodec)                              // → ColumnTypeDescriptor
columnFor(pgVectorCodec)({ length: 1536 })        // → ColumnTypeDescriptor & { typeParams: { length: 1536 } }
```

Once the per-codec factory carries the resolved type on its return, `columnFor` adds no type information — it's just a pass-through. It also adds a layer of indirection at the call site (`columnFor(pgVectorCodec)(...)` vs `vector(...)`) that pack-author idioms don't need. So it's gone. Pack authors export `vector`, `char`, `numeric`, `json`, `cipherStashText` directly.

---

## Case V — Vector (literal-typed numeric param)

The minimum viable parameterized codec: numeric param, literal-preserved, output is a branded type parameterized by the literal (`Vector<N>`). Same shape as `char(N)`, `numeric(p, s)`, `timestamp(N)`. From [spec.md § Case V](../spec.md#case-v--vector-literal-typed-numeric-param).

### Before

```typescript
// codec object
const pgVectorCodec = codec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  renderOutputType: (typeParams) => `Vector<${typeParams['length']}>`,
  encode: (value: number[]) => `[${value.join(',')}]`,
  decode: (wire: string) => parseVector(wire),
  meta: { /* … */ },
});

// hand-rolled factory (throws away type info)
export function vector<N extends number>(length: N) {
  return { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length } } as const;
}

// user schema
const Document = {
  columns: {
    id:        textCodec,
    embedding: vector(1536),
  },
};
```

In the no-emit path, `Document.embedding`'s field type resolves to `number[]` — the bug.

### After

```typescript
// curried factory — the type-level surface AND the runtime implementation
export function vector<N extends number>(length: N): (ctx: Ctx) =>
  Codec<'pg/vector@1', ['equality'], string, Vector<N>> {
  return (ctx) => ({
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

// descriptor for framework registration
export const pgVectorCodec: ParameterizedCodecDescriptor<{ length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: vector,
};

// user schema — same call site, fixed types
const Document = {
  columns: {
    id:        textCodec,
    embedding: vector(1536),
  },
};
```

`Document.embedding` resolves to `Vector<1536>` in both the emit path (via `renderOutputType`) and the no-emit path (via the factory's TS return type). Migration is a single replace at the user's call site (`vector(1536)` was already the call shape — only the factory's internal definition changes).

### What this case pins

- The factory's TS return type carries the resolved column type (`Vector<N>`), parameterized over the literal numeric `N`.
- `vector(1536)` must preserve `1536` through TS inference into the `Codec`'s `Js` slot.
- The descriptor's `renderOutputType` and the factory's TS return type produce *the same* TS source for the same params — verified per-codec by a test (so emit and no-emit can't drift).
- No type cast required in the factory definition.

---

## Case V (variant) — `char(N)`, `numeric(p, s)`, and friends

A pack author adds Postgres `char(N)` support.

```typescript
export type Char<N extends number = number> = string & { readonly __charLength?: N };

export function char<N extends number>(length: N): (ctx: Ctx) =>
  Codec<'pg/char@1', ['equality', 'order'], string, Char<N>> {
  return (ctx) => ({
    id: 'pg/char@1',
    targetTypes: ['char'],
    traits: ['equality', 'order'],
    typeParams: { length },
    encode: (s: string) => s,
    decode: (s: string) => s as Char<N>,
    encodeJson: (s) => s,
    decodeJson: (j) => j as Char<N>,
  });
}

export const pgCharCodec: ParameterizedCodecDescriptor<{ length: number }> = {
  codecId: 'pg/char@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Char<${length}>`,
  factory: char,
};

// user schema
const User = {
  columns: {
    id: char(36),                                            // FieldOutputType resolves to Char<36>
  },
};
```

The pack ships ~25 lines and gets correct emit-path *and* no-emit-path types, runtime validation of `params`, and the user-facing `char(N)` ergonomic. `numeric(precision, scale)` and `timestamp(precision)` follow the same shape with multi-key params.

This variant pins the same constraints as Case V plus: the per-pack burden must collapse to ~25 lines so adding a parameterized codec doesn't read as a framework extension.

---

## Case J — JSON-with-schema

The output type is derived from a *value* (the user's schema), not from a literal. From [spec.md § Case J](../spec.md#case-j--json-with-schema).

```typescript
import { type } from 'arktype';
import { json } from '@prisma-next/postgres-core';

const ProductSettings = type({
  visibility: "'public' | 'private'",
  pricing:    { currency: "'USD' | 'EUR'", amount: 'number' },
});

const Product = {
  columns: {
    id:       textCodec,
    settings: json(ProductSettings),
  },
};

// FieldOutputType resolves Product.settings to:
//   { visibility: 'public' | 'private'; pricing: { currency: 'USD' | 'EUR'; amount: number } }
```

The same schema:

- Validates wire payloads at runtime.
- Types the column at the no-emit type level.
- Drives the emitted `contract.d.ts` at the emit path (the `renderOutputType` for `json` calls into the schema's TS-source serialization, if any; `'unknown'` otherwise).

### What this case pins

- `paramsSchema: StandardSchemaV1<…>` — a JSON schema lives next to the codec author as a *value* and must compose with whatever schema library the user picks. `Type<…>` (arktype-only) doesn't generalize; Standard Schema does.
- The factory's signature accepts a generic `S extends StandardSchemaV1` and produces `Codec<…, InferOutput<S>>` as its return type. Standard TS inference; no HKT.
- `json` is a parameterized codec like any other — no JSON-specific surface in the framework. This means the same pattern composes for **encrypted JSON** (Case C subcase): `encryptedJson<S>(schema, params)` reuses this idiom.
- We must not write a JSON-Schema → TS converter. Composition with the user's schema library replaces it.

(Note: schema-driven inference for JSON columns is a *restoration* of pre-regression behavior — JSON columns inferred through their schema before the no-emit path was introduced; [TML-2229](https://linear.app/prisma-company/issue/TML-2229) restores it through the new mechanism.)

---

## Pack-author guidance preview

The README section that ships in M6 (close-out) covers, in order:

1. **Decide if your codec is parameterized.** No params? Plain codec object via `codec({…})`. Params? Curried factory + `ParameterizedCodecDescriptor`.
2. **Write the factory function.** Curried: `(params) => (ctx) => Codec<Id, Traits, Wire, Js>`. The TS return type is the column's resolved type.
3. **Pick `paramsSchema`.** Any Standard Schema (Arktype recommended).
4. **Implement `renderOutputType`** on the descriptor. Pure function from `params` to a TS source string for the emit path. Optional but strongly recommended; absent → emitter falls back to base output.
5. **Export both** the factory function (user-facing) and the descriptor (framework-facing).
6. **For JSON-shaped columns**, use `json(schema)` from `@prisma-next/postgres-core` rather than rolling your own.
7. **Cross-cutting**: use `storage.types` for shared types; inline factory calls for one-offs.
8. **`ctx` is supplied by the framework.** Stateless codecs ignore it; stateful codecs (encryption, regex compilation, params-derived caches) close over it. The runtime calls the factory once per `storage.types` instance at contract load — see [TML-2330](https://linear.app/prisma-company/issue/TML-2330) for runtime status.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §2, §3, §5, §7](../spec.md#how-it-works), [AC-1](../spec.md#ac-1-higher-order-codec-factories-type-resolve-correctly), [AC-3](../spec.md#ac-3-authoring-side-ctx-is-supplied-to-factories), [AC-5](../spec.md#ac-5-json-factory-ships).
- Plan: [plan.md M3, M4](../plan.md#m3--ship-the-json-factory).
- Mechanism details: [higher-order-codecs.md](higher-order-codecs.md).
- Runtime contract for the factory's runtime call + `storage.types`: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
