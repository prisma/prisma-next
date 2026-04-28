# Design — Codec interface and brand

**Audience:** framework maintainers and reviewers of the M1 / M2 PRs.

**What this doc covers:** the codec interface split (`Codec` vs `ParameterizedCodec`), the type-level brand mechanism (`CodecBrand` + `Apply`), the `parameterizedCodec({…})` factory, the `init(params, instanceMeta)` signature, and the no-emit `FieldOutputType` rewrite. Companion docs:

- [authoring-ergonomics.md](authoring-ergonomics.md) — `columnFor`, `jsonCodec`, worked examples.
- [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md) — runtime materialization contract, downstream extension fit.

---

## Decision

The codec interface splits into two:

```typescript
// Pure encode/decode/traits. No parameterization fields.
export interface Codec<Id, Traits, Wire, Js> { … }

// Adds parameterization. All shown fields are required (init is optional).
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

export interface CodecBrand<Params = unknown> {
  readonly Input: Params;
  readonly Output: unknown;
}

export type Apply<B extends CodecBrand, P> = (B & { readonly Input: P })['Output'];
```

A `parameterizedCodec({…})` factory enforces the requirements at the type level. The brand is co-located on each parameterized codec; no global declaration merging.

The no-emit `FieldOutputType<Definition>` is rewritten to follow `typeRef` through `storage.types`, then apply `Apply<codec.Brand, column.typeParams>` when the codec is parameterized; falls through to the codec's base output otherwise. Nullability preserved.

This satisfies [AC-1](../spec.md#ac-1-brand-mechanism-works-at-the-type-level), [AC-2](../spec.md#ac-2-no-emit-fieldoutputtype-resolves-correctly), [AC-5](../spec.md#ac-5-base-codec-is-clean), and [AC-6](../spec.md#ac-6-initparams-instancemeta-signature-is-locked).

### Driving cases

The interface decisions below are checked against three concrete cases from [spec.md § Cases that pin the design](../spec.md#cases-that-pin-the-design):

- [**Case V — Vector**](../spec.md#case-v--vector-literal-typed-numeric-param) (literal-typed numeric param). Pins the brand HKT, `paramsSchema` validation, and the symmetry between `renderOutputType` and `Brand`. Worked code: [authoring-ergonomics.md#case-v](authoring-ergonomics.md#case-v--vector-literal-typed-numeric-param).
- [**Case J — JSON-with-schema**](../spec.md#case-j--json-with-schema) (output type derived from a schema *value*). Pins `paramsSchema: StandardSchemaV1<…>` and the brand's ability to project a type out of one of its inputs. Worked code: [authoring-ergonomics.md#case-j](authoring-ergonomics.md#case-j--json-with-schema).
- [**Case C — CipherStash column-scoped encryption**](../spec.md#case-c--cipherstash-column-scoped-encryption). Pins the `init(params, instance)` signature and the `storage.types`-instance keying. Worked code: [runtime-contract-and-compatibility.md#case-c](runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption).

Each subsection below indicates which case(s) it answers to.

---

## Brand mechanism

*Driving cases:* V, J. Case V needs literal numeric inference (`{ length: 1536 }` → `Vector<1536>`); Case J needs the brand to project a type *out of* one of its inputs (`{ schema: S }` → `InferOutput<S>`). Both demand the same primitive: a type-level function from `Params` to output. The HKT idiom below covers both.

The brand is a type-level function from `Params` to the codec's output type, defined next to the codec:

```typescript
// pgvector
export interface VectorBrand extends CodecBrand<{ length: number }> {
  readonly Input: { length: number };
  readonly Output: this['Input'] extends { length: infer N extends number }
    ? Vector<N>
    : never;
}
```

`Apply` evaluates the brand by overriding its `Input`:

```typescript
type Result = Apply<VectorBrand, { length: 1536 }>;
//   ^? Vector<1536>
```

The mechanism is the `this['Input']` HKT idiom: TypeScript reaches close to higher-kinded types through `this`-conditional types. `&` overrides `Input`; `['Output']` triggers the brand's conditional with the new `Input`.

### Co-location

Each parameterized codec defines and carries its own brand:

```typescript
// packages/3-extensions/pgvector/src/core/codecs.ts
export interface VectorBrand extends CodecBrand<{ length: number }> { … }

export const pgVectorCodec = parameterizedCodec({
  id: 'pg/vector@1',
  // …
  Brand: undefined as unknown as VectorBrand,
});
```

`Brand` is a phantom field (no runtime payload). The single `as unknown as VectorBrand` cast is the only cast in the migration; reviewers reject any other use.

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

Field-by-field:

- **`paramsSchema`**: a Standard Schema. Replaces the existing arktype-only `Type<TParams>` (Arktype implements Standard Schema, so existing schemas keep working). Lets pack authors use any Standard-Schema-compliant library.
- **`renderOutputType`**: emit-path string for `contract.d.ts`. No longer optional.
- **`Brand`**: type-level twin of `renderOutputType`. Phantom; carries the brand's identity through TS inference.
- **`init?`**: optional hook for codecs that need per-instance state. See [Init signature](#init-signature).

Generic parameter ordering is chosen so callers usually only need to specify `TParams` and `TBrand` explicitly when extending.

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

Enforces:

- Omitting any of `paramsSchema`, `renderOutputType`, `Brand` — compile error.
- `Brand['Input']` not assignable from `Params` — compile error.
- The factory is the only normal way to build a `ParameterizedCodec`.

### Where it lives

[Open question 2](../spec.md#open-questions): default location is `@prisma-next/framework-components` so Mongo benefits without a parallel SQL/Mongo split. SQL or Mongo can wrap thinly if a domain-specific narrowing is needed.

---

## Init signature

*Driving case:* C. CipherStash's encryption codec needs to know which `(table, column)` pairs it serves so it can derive a column-scoped key once per `storage.types` instance. The current `init?(params)` signature can't express that. Authors of simpler codecs (precompiled regex, params-derived constants) also benefit from a stable hook even though they don't need column context. See [runtime-contract-and-compatibility.md#case-c](runtime-contract-and-compatibility.md#case-c--cipherstash-column-scoped-encryption) for the worked authoring code.

The optional `init` hook accepts `(params, instance)`:

```typescript
readonly init?: (
  params: TParams,
  instance: {
    readonly name: string;
    readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  },
) => THelper;
```

`name` is the `storage.types` instance name (e.g. `'Embedding1536'`). `usedAt` is the list of `(table, column)` pairs that reference the instance — typically one, occasionally several when multiple columns share a `storage.types` entry. Inline-`typeParams` columns produce anonymous instances with one-element `usedAt` lists; see [runtime-contract-and-compatibility.md#anonymous-vs-named-instances](runtime-contract-and-compatibility.md#anonymous-vs-named-instances).

### Why declare it now (vs. leaving the existing `init?(params)` signature)

Codecs that need column context — encryption codecs deriving keys from `(table, column)` (CipherStash G1), audit codecs needing column paths for log lines, regex codecs precompiling per-instance — can't function with `params` alone. Locking the right shape now is free; locking the wrong shape and migrating later is not.

The runtime side (calling `init` once per `storage.types` instance, routing dispatch through the helper) is **out of scope** here — see [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md). We ship the signature only.

---

## Rewriting the no-emit `FieldOutputType`

*Driving cases:* V, J, C. All three need the no-emit path to resolve the column's TS type through the brand: V pins literal preservation, J pins schema-derived inference, C pins resolution through `typeRef` to a shared `storage.types` instance.

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

Three changes:

1. **`ResolveColumn` follows `typeRef`** through `storage.types` and reattaches the column's `nullable` flag. Inline-`typeParams` columns pass through unchanged.
2. **Brand check.** If the codec entry has a `Brand`, `Apply<Brand, typeParams>` resolves the precise type. Otherwise we fall through to the codec's base output.
3. **Nullability** is applied uniformly via `ApplyNullable`.

`CodecsFromDefinition<Definition>` is a new helper exposing full codec entries (not just the `CodecTypes` map of `{ output }`). `CodecBaseOutput<C>` is `C['Js']` (the existing base output).

### Why this is small

- No change to `ComputeColumnJsType`; it already delegates through `ExtractFieldOutputTypes<Contract>`.
- No change in the no-parameterized case (the brand check fails through to the existing base-output fallback).
- The synthetic test fixture in M2 lets us land the rewrite *before* any production codec gets a brand.

---

## Why split `Codec` and `ParameterizedCodec` (vs. additive)

The alternative is to add `Brand?: CodecBrand` next to the existing optional `paramsSchema?` / `renderOutputType?` / `init?` on the base `Codec`. Smaller diff, but:

- **Optional everywhere.** Every consumer (emitter, validator, runtime context builder, type resolver) keeps handling `undefined` for codecs that fundamentally don't need parameterization.
- **No documentation value.** The split reads as "your codec needs parameters? extend `ParameterizedCodec`; otherwise stay on `Codec`." Optional fields don't.
- **Doesn't unblock cleanup.** [AC-5](../spec.md#ac-5-base-codec-is-clean) (remove parameterization fields from base) requires the split.

We pick the split.

---

## Rejected alternatives

### Keep brand fields optional on base `Codec`

Discussed in [Why split `Codec` and `ParameterizedCodec`](#why-split-codec-and-parameterizedcodec-vs-additive). Smaller diff but forfeits cleanup and docs.

### Global `CodecOutputBrands` declaration merging

Sketch:

```typescript
declare module '@prisma-next/framework-components' {
  interface CodecOutputBrands {
    'pg/vector@1': { /* brand */ };
  }
}
```

Rejected:

- **Ambient global pollution.** Every codec in the workspace lands in a single global namespace with order-dependent merging. Type errors point at the global, not the codec.
- **Discovery surface mismatch.** The brand belongs to the codec, not the framework. Co-locating makes the codec self-describing.
- **Doesn't generalize.** Multiple codecs with the same `id` (versioned, vendored) are awkward; the codec object already carries the necessary identity.

### Compute brand from the codec's `output` type alone

Have a "smart" `FieldOutputType` narrow the codec's existing `output` (e.g. `number[]`) using `typeParams`. Rejected: there's no general path from `(number[], { length: 1536 })` to `Vector<1536>` without somewhere encoding the relationship — which is exactly what `Brand` does. Doesn't generalize to JSON-with-schema.

### Per-extension factories carry parameter awareness without a brand

Existing per-codec factories (`vector(N)`) preserve literal-typed `typeParams`. Have `FieldOutputType` consult both the column's `typeParams` and the codec's factory's return type. Rejected: TypeScript doesn't expose a factory's return type from a codec ID; doesn't unify `typeRef` and inline-`typeParams`; doesn't generalize.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §1, §2, §3, §6](../spec.md#how-it-works), [Acceptance criteria AC-1, AC-2, AC-5, AC-6](../spec.md#acceptance-criteria).
- Plan: [plan.md M1, M2, M5](../plan.md#m1--codec-interface-split--brand-mechanism).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- Runtime impact + extension fit: [runtime-contract-and-compatibility.md](runtime-contract-and-compatibility.md).
- ADR 186: [docs/architecture docs/adrs/ADR 186 - Codec-dispatched type rendering.md](../../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).
- Standard Schema: <https://github.com/standard-schema/standard-schema>.
