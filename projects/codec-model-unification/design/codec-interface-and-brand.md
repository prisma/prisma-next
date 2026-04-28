# Design — Codec interface and brand

**Audience:** framework maintainers and reviewers of the M1/M2 PRs.

**What this doc covers:** the interface split (`Codec` vs `ParameterizedCodec`), the type-level brand mechanism (`CodecBrand` + `Apply`), the factory, the `init(params, instanceMeta)` signature, and the no-emit `FieldOutputType` rewrite. Companion docs:

- [authoring-ergonomics.md](authoring-ergonomics.md) — `columnFor`, `jsonCodec`, worked examples.
- [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md) — runtime materialization contract; downstream extension fit.

---

## Background

The codec interface today (after [ADR 186](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) carries parameterization as a sprinkle of optional fields on the base `Codec`:

```typescript
interface Codec<Id, Traits, Wire, Js> {
  // …non-parameterization fields…
  readonly paramsSchema?: Type<Record<string, unknown>>;
  readonly renderOutputType?: (params: Record<string, unknown>) => string;
  readonly init?: (params: Record<string, unknown>) => unknown;
}
```

This shape has three problems:

1. **Optional everywhere.** Every consumer (the emitter, the validator, the runtime context builder) has to handle the case where `renderOutputType` exists, where it doesn't, where `init` exists, where it doesn't. The optionality is fictional — for any given codec the shape is fixed; the optionality is only there because the interface doesn't distinguish the two kinds of codec.

2. **No type-level twin of `renderOutputType`.** The emit path resolves `vector(1536)` to `Vector<1536>` by calling `renderOutputType({ length: 1536 })` and pasting the resulting string into `contract.d.ts`. The no-emit path (no `pnpm emit` step, type-only) has no equivalent — `FieldOutputType` looks up `CodecTypes[id]['output']` (the codec's *base* output type) and ignores `typeParams` entirely. That's the [TML-2229](https://linear.app/prisma-company/issue/TML-2229) bug.

3. **Fragmented authoring surface.** Each parameterized codec exposes a hand-rolled column factory (`vector(length)`, `char(length)`, `numeric(precision, scale)`) that does the same boilerplate. JSON columns have no first-class way to project a user's schema into a precise output type.

The fix is small if we promote parameterization to a first-class shape on the codec.

---

## Why split `Codec` and `ParameterizedCodec`

### The split

```typescript
export interface Codec<Id, Traits, Wire, Js> {
  // …pure encode/decode/traits/meta — no parameterization fields…
}

export interface ParameterizedCodec<
  Id, Traits, Wire, Js,
  Params,
  Brand extends CodecBrand<Params>,
  Helper = unknown,
> extends Codec<Id, Traits, Wire, Js> {
  readonly paramsSchema: StandardSchemaV1<Params>;
  readonly renderOutputType: (params: Params) => string;
  readonly Brand: Brand;
  readonly init?: (params: Params, instance: InstanceMeta) => Helper;
}
```

### What it buys us

- **Required fields on `ParameterizedCodec`.** A parameterized codec without a brand is a type error at the factory call site. The emitter and validator can stop checking for `undefined`.
- **Empty by default.** Non-parameterized codecs (most of them — `text`, `int`, `boolean`, etc.) are described by `Codec` alone, no parameterization noise.
- **Single point of evolution.** Future parameterization-related slots (richer `init`, runtime reuse, parameter-derived helpers) attach to `ParameterizedCodec` without touching base `Codec`.
- **Mirrors emit/no-emit paths.** `renderOutputType` (runtime, emit path) and `Brand` (type level, no-emit path) live next to each other on the same interface — the symmetry is part of the API.

### Why now (vs. inside the existing `Codec`)

- The existing optional-fields shape *can* be made to work for the brand (`Brand?: CodecBrand` on base), but it inherits the "optional fictional" problem and forces `FieldOutputType` to handle the missing-brand case for codecs that fundamentally don't need one. The split is what makes the brand non-optional, and that's what makes the rewrite of `FieldOutputType` clean.
- The interface is consumed by extension authors (CipherStash, others). A clear `Codec` vs `ParameterizedCodec` split reads as documentation: "your codec needs parameters? extend `ParameterizedCodec`; otherwise stay on `Codec`."

---

## The brand mechanism

The brand is a type-level function from `Params` to the codec's output type.

### `CodecBrand`

```typescript
export interface CodecBrand<Params = unknown> {
  readonly Input: Params;
  readonly Output: unknown;
}
```

`Input` and `Output` are the brand's "argument" and "return" slots. Each parameterized codec defines a `CodecBrand` whose `Output` is a conditional type referencing `this['Input']`:

```typescript
// pgvector
export interface VectorBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number }
    ? Vector<N>
    : never;
}
```

### `Apply<B, P>`

```typescript
export type Apply<B extends CodecBrand, P> = (B & { readonly Input: P })['Output'];
```

The `&` overrides `Input` with the caller-supplied `P`; `['Output']` triggers the brand's conditional type to fire with the new `Input`. This is the `this['Input']` HKT idiom — TypeScript gets close to higher-kinded types through `this`-conditional types.

### Co-location

Each parameterized codec defines the brand right next to itself:

```typescript
// packages/3-extensions/pgvector/src/core/codecs.ts
export interface VectorBrand extends CodecBrand<{ length: number }> { … }

export const pgVectorCodec = parameterizedCodec({
  id: 'pg/vector@1',
  // …
  Brand: undefined as unknown as VectorBrand,
});
```

The `as unknown as VectorBrand` cast is the *only* cast in the migration. It's justified because `Brand` is a phantom field — it has no runtime value, only a type. Reviewers should reject any other use of this cast pattern in this project.

### Why not global declaration merging

Earlier sketches proposed a global `CodecOutputBrands` interface that codecs would augment via declaration merging:

```typescript
declare module '@prisma-next/framework-components' {
  interface CodecOutputBrands {
    'pg/vector@1': { /* brand */ };
  }
}
```

This was rejected. Reasons:

- **Ambient global pollution.** Every codec in the workspace winds up in a single global namespace with order-dependent merging. Type errors point at the global, not the codec.
- **Discovery surface mismatch.** The brand belongs to the codec, not the framework. Co-locating it makes the codec self-describing.
- **Doesn't generalize.** Multiple codecs with the same `id` (versioned, vendored) are awkward; the codec object already carries the necessary identity.

The `this['Input']` HKT pattern keeps everything local with no global reach.

---

## The `ParameterizedCodec` interface

```typescript
export interface ParameterizedCodec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
  TParams = Record<string, unknown>,
  TBrand extends CodecBrand<TParams> = CodecBrand<TParams>,
  THelper = unknown,
> extends Codec<Id, TTraits, TWire, TJs> {
  readonly paramsSchema: StandardSchemaV1<TParams>;
  readonly renderOutputType: (params: TParams) => string;
  readonly Brand: TBrand;
  readonly init?: (
    params: TParams,
    instance: {
      readonly name: string;
      readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
    },
  ) => THelper;
}
```

### Notes on each field

- **`paramsSchema`** (FR3): the user-supplied Standard Schema. Replaces the existing `Type<TParams>` (arktype-only) typing. Arktype `Type` already implements Standard Schema, so existing schemas keep working.
- **`renderOutputType`** (no longer optional): emit-path string for `contract.d.ts`. Used unchanged.
- **`Brand`**: type-level twin of `renderOutputType`. Phantom field; no runtime payload.
- **`init?`** (FR8 — signature only): see below.

The order of generics is chosen so that callers usually only need to specify `TParams` and `TBrand` explicitly when extending.

---

## The factory: `parameterizedCodec({…})`

```typescript
export function parameterizedCodec<
  Id extends string,
  TTraits extends readonly CodecTrait[],
  TWire,
  TJs,
  TParams,
  TBrand extends CodecBrand<TParams>,
  THelper = unknown,
>(spec: {
  id: Id;
  // …other shared codec spec fields…
  paramsSchema: StandardSchemaV1<TParams>;
  renderOutputType: (params: TParams) => string;
  Brand: TBrand;
  init?: (params: TParams, instance: InstanceMeta) => THelper;
}): ParameterizedCodec<Id, TTraits, TWire, TJs, TParams, TBrand, THelper> { … }
```

### What it enforces

- Omitting any of `paramsSchema`, `renderOutputType`, `Brand` is a compile error.
- A `Brand` whose `Input` is not assignable from `Params` is a compile error.
- The factory is the only normal way to build a `ParameterizedCodec`.

### Where it lives

Open question 2 in [spec.md](../spec.md#open-questions): default location is `@prisma-next/framework-components` so Mongo benefits without a parallel SQL/Mongo split. SQL or Mongo can wrap thinly if a domain-specific narrowing is needed (e.g. SQL adds a `meta` field).

---

## Init signature

### Why we're declaring it now

The current `init?(params)` signature is broken for any codec that needs to know *which column it serves* — encryption codecs derive a key from `(table, column)`, audit codecs need the column path for log lines, etc. CipherStash G1 calls this out explicitly.

The fix is to pass `instanceMeta`:

```typescript
readonly init?: (
  params: TParams,
  instance: {
    readonly name: string;
    readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  },
) => THelper;
```

`name` is the `storage.types` instance name (e.g. `Embedding1536`). `usedAt` is the list of `(table, column)` pairs that share this instance — typically one, occasionally several when multiple columns reference the same `storage.types` entry.

### Why "shape only"

Implementing the runtime side — calling `init` once per `StorageTypeInstance` at context-builder time and routing `encode`/`decode` through the named helper — is a follow-up ([TML-2330](https://linear.app/prisma-company/issue/TML-2330)). See [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md). We declare the shape now because:

- It costs nothing extra to ship the right signature with the rest of the interface change.
- Future runtime work consumes a stable surface; downstream extensions (CipherStash) can author against it before we wire the runtime.
- A wrong signature here is the kind of mistake that causes a downstream rewrite later.

### Anonymous instances

Inline `typeParams` (no `typeRef`) raise the question: what's the `name`? Default in [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md) is to materialize an anonymous instance (`name = '<anon-${table}.${column}>'`). The `usedAt` list still has exactly one entry. Whichever way the runtime resolves it, the *signature* doesn't change.

---

## Rewriting the no-emit `FieldOutputType`

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

Three issues:

- Doesn't read `Col['typeParams']`.
- Doesn't follow `Col['typeRef']` into `storage.types`.
- Resolves to the codec's *base* output, regardless of params.

### Rewritten implementation (sketch)

```typescript
type ResolveColumn<Definition, Col> =
  Col extends { readonly typeRef: infer Ref extends string }
    ? StorageTypesFromDefinition<Definition>[Ref] extends infer Resolved
      ? Resolved & { readonly nullable: Col extends { readonly nullable: true } ? true : false }
      : never
    : Col;

type FieldOutputType<Definition, ModelName, FieldName> =
  ModelStorageColumn<Definition, ModelName, FieldName> extends infer Col
    ? ResolveColumn<Definition, Col> extends infer R
      ? R extends { readonly codecId: infer Id extends string }
        ? CodecsFromDefinition<Definition>[Id] extends infer C
          ? C extends { readonly Brand: infer B extends CodecBrand }
            ? R extends { readonly typeParams: infer P }
              ? ApplyNullable<R, Apply<B, P>>
              : ApplyNullable<R, CodecBaseOutput<C>>
            : ApplyNullable<R, CodecBaseOutput<C>>
          : unknown
        : unknown
      : unknown
    : unknown;
```

Three things change:

1. **`ResolveColumn` follows `typeRef`** through `storage.types` and reattaches the column's `nullable` flag. Inline-`typeParams` columns pass through unchanged.
2. **Brand check.** If the codec entry has a `Brand`, `Apply<Brand, typeParams>` resolves the precise type. Otherwise we fall through to the base output.
3. **Nullability** is applied uniformly via `ApplyNullable`.

`CodecsFromDefinition<Definition>` is a new helper that exposes the full codec entries (not just the `CodecTypes` map of `{ output }`). `CodecBaseOutput<C>` is `C extends ParameterizedCodec ? ApplyToDefault : C['Js']` (the existing base output).

### Why this is small

- No change to `ComputeColumnJsType`; it already delegates through `ExtractFieldOutputTypes<Contract>`.
- No change to existing test fixtures in the no-parameterized case (the brand check fails through to the existing base-output fallback).
- The synthetic test fixture in M2.1 lets us land the rewrite *before* any production codec gets a brand.

---

## Rejected alternatives

### A1. Keep brand fields optional on base `Codec`

Considered. Rejected because:

- Forces every consumer to handle missing `Brand` even for codecs that fundamentally don't need it.
- Doesn't deliver the documentation value of "your codec needs parameters? extend `ParameterizedCodec`."
- Doesn't unblock removing the optional emit-path/init/params noise from base `Codec`.

### A2. Global `CodecOutputBrands` declaration merging

Discussed in [Why not global declaration merging](#why-not-global-declaration-merging). Rejected for global pollution, discovery mismatch, and version-handling brittleness.

### A3. Compute brand from the codec's `output` type via TS conditional types alone

A "smart" `FieldOutputType` could try to narrow the codec's existing `output` type using `typeParams`. Rejected because:

- The existing `output` is the *base* type (e.g. `number[]`); there's no direct path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is exactly what `Brand` does.
- Pushes the extension burden onto the framework; pack authors have no way to influence the result.

### A4. Move parameter awareness to per-extension factories without a brand

The current per-codec factories (`vector(N)`) do produce literal-typed `typeParams`. We could just have `FieldOutputType` consult the column's `typeParams` and the codec's *factory's return type* somehow. Rejected because:

- TS doesn't expose the factory's return type from the codec ID. The brand makes the relationship explicit and locatable.
- Doesn't generalize to JSON-with-schema cleanly.
- Doesn't unify `typeRef` and inline-`typeParams` resolution.

---

## Cross-references

- Spec: [spec.md FR1, FR2, FR3, FR5, FR7, FR8](../spec.md#requirements).
- Plan: [plan.md M1, M2](../plan.md#m1--brand-mechanism--parameterizedcodec).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- Runtime impact + extension fit: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- ADR 186: [docs/architecture docs/adrs/ADR 186 - Codec-dispatched type rendering.md](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
