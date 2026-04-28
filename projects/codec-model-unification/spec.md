# Summary

Unify how parameterized codecs (e.g. `vector(1536)`, `char(36)`, JSON-shaped scalars) describe their type parameters so that the **no-emit path** resolves field output types to the same precise, branded TypeScript types the **emit path** already produces. Achieved by promoting parameterization into a first-class `ParameterizedCodec` interface with a type-level brand (`this['Input']` HKT idiom), a single `columnFor` authoring helper, and standard-schema-driven JSON inference.

# Description

## Problem

The contract-first data layer has two paths from PSL/TS authoring to the typed surface (`db.tables.X.columns.Y` etc.):

1. **Emit path**: `pnpm emit` runs the emitter, walks the contract, calls `Codec.renderOutputType(typeParams)` on each parameterized codec, and writes a fully-resolved `contract.d.ts` (`FieldOutputTypes` is a literal map of model → field → resolved TS type expression).
2. **No-emit path**: the user imports the contract definition directly and computes `FieldOutputTypes<Definition>` at the type level inside `contract-types.ts`. There is no codegen step.

[ADR 186 — Codec-dispatched type rendering](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) introduced `renderOutputType` to fix the emit path and explicitly **deferred the no-emit path** to follow-up work (this project).

Today, the no-emit `FieldOutputType` in [`contract-types.ts`](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts) does this:

```typescript
type FieldOutputType<…> = ModelStorageColumn<…> extends infer Col
  ? Col extends { readonly codecId: infer Id extends string }
    ? Id extends keyof CodecTypesFromDefinition<Definition>
      ? CodecTypesFromDefinition<Definition>[Id] extends { readonly output: infer O }
        ? Col extends { readonly nullable: true } ? O | null : O
        : unknown
      : unknown
    : unknown
  : unknown;
```

It looks up `CodecTypes[id]['output']` (the **base** output type) and **completely ignores `Col['typeParams']`**. So `vector(1536)` resolves to `number[]` instead of `Vector<1536>`, `char(36)` resolves to `string` instead of `Char<36>`, and a JSON column with a narrowed schema resolves to `JsonValue` instead of the schema's inferred type.

## Underlying design issues

The original ticket ([TML-2229](https://linear.app/prisma-company/issue/TML-2229)) asks to "restore" the parameterized output behaviour for the no-emit path. We chose to ignore the ticket's framing because the underlying design has three problems that, if left in place, will keep producing the same bug class:

1. **Parameterization is a scattered, optional concern on the base `Codec` interface.** `paramsSchema?`, `init?`, `renderOutputType?`, and the column descriptor's `typeParams` all carry pieces of the contract; nothing is type-checked across them. This is the root cause of the no-emit/emit drift.
2. **Authoring parameterized columns is ad-hoc.** Every parameterized type in every extension (`vector(N)`, future `char(N)`, JSON helpers) defines its own factory by hand, repeating the same `{ codecId, nativeType, typeParams }` literal-preserving boilerplate. There is no shared validation, no shared shape, and no single place to teach pack authors what to do.
3. **Downstream type evaluation is fragile.** `FieldOutputType` in the no-emit path is the canonical example, but consumers (`ComputeColumnJsType`, ORM column handles, query-builder return types, future `Expression<T>` typing from PR #374) all need the same resolution. Solving the no-emit path with a one-off conditional that re-implements `renderOutputType` at the type level would deepen this fragility.

## Solution shape

Promote parameterization into a first-class shape on the codec model:

- **Split `Codec` and `ParameterizedCodec`.** Non-parameterized codecs remain on the existing `Codec` interface. Codecs that take type params extend `ParameterizedCodec` which **requires** `paramsSchema`, `renderOutputType`, and a type-level **brand** (an HKT-shaped object whose `Output` depends on `Input`).
- **Add a type-level brand using the `this['Input']` HKT idiom.** The codec carries `readonly Brand: CodecBrand` where `CodecBrand` has `Input` and `Output` fields and `Output` is a conditional expression that references `this['Input']`. Applying the brand at the type level (`Apply<Brand, Params>`) produces the resolved output type — the type-level twin of `renderOutputType` at runtime.
- **Replace per-extension column factories with a single `columnFor` helper.** `columnFor(codec)` is type-discriminated: when `codec` is `ParameterizedCodec` it returns a function `(params) => ColumnTypeDescriptor & { typeParams: Params }`; otherwise it returns the descriptor directly. Pack authors stop writing factories.
- **Use standard-schema-driven inference for JSON-shaped codecs.** A pack author wraps an Arktype/Zod schema; the helper returns a JSON codec whose brand maps `{ schema }` to the schema's inferred type. We do not write a JSON-Schema → TS converter ourselves.
- **Rewrite the no-emit `FieldOutputType` once, against the brand.** It becomes: if the codec is parameterized and the column carries `typeParams`, return `Apply<Brand, typeParams>`; else return the base output type.

This keeps the runtime cost of the no-emit path bounded (one conditional per codec lookup, one brand application) and pushes the author-facing surface into a single helper instead of N hand-rolled factories.

## Users

- **Pack authors** (internal & external): people writing target/extension packs that ship parameterized codecs (pgvector, JSON-schema codecs, future `char(N)`, Postgres `numeric(p, s)`, etc.).
- **Schema authors**: TypeScript developers who declare columns using parameterized types (`vector(1536)`, `embedding1536`, …) and expect the resolved JS type to be the branded type.
- **Downstream type machinery**: `ComputeColumnJsType`, ORM column handles, query-builder return types, the `Expression<T>` system from [PR #374](https://github.com/prisma/prisma-next/pull/374) — all consume `FieldOutputTypes<Definition>` and benefit from the fix.

## Linear

[TML-2229](https://linear.app/prisma-company/issue/TML-2229) — original framing was narrow ("restore parameterized output types in `StagedFieldOutputTypes`"); this project widens scope to the underlying design (codec model unification) and resolves TML-2229 as a consequence.

## Project base

This branch is based on [PR #374 — `feat(operations): author sql operations as TypeScript functions`](https://github.com/prisma/prisma-next/pull/374) (`origin/worktree/op-registry-ts`). PR #374 introduces `Expression<T>`, `CodecExpression<…>`, and the operations-as-TS-functions surface. The new `Brand` carried on `ParameterizedCodec` plugs directly into `CodecExpression<…>` so an expression over a parameterized column carries the brand-resolved output type, not the base type. Sequencing this work after #374 avoids reworking `Expression<T>` twice.

# Requirements

## Functional Requirements

### FR1. `ParameterizedCodec` interface

Add a `ParameterizedCodec<Id, Traits, Wire, Js, Params, Helper, Brand>` interface that **extends** the SQL `Codec`. Required members beyond `Codec`:

- `paramsSchema: StandardSchemaV1<Params>` — runtime validation for `typeParams` on `storage.types` entries and inline column `typeParams`.
- `renderOutputType: (params: Params) => string` — required (not optional) on parameterized codecs. Used by the emit path.
- `init?: (params: Params) => Helper` — optional runtime helper hook (already exists on the codec; required signature here).
- `readonly Brand: Brand extends CodecBrand` — type-level twin of `renderOutputType`.

`CodecBrand` and `Apply` are defined as:

```typescript
interface CodecBrand {
  readonly Input: unknown;
  readonly Output: unknown;
}
type Apply<B extends CodecBrand, P> = (B & { readonly Input: P })['Output'];
```

The factory `parameterizedCodec({ … })` constructs a `ParameterizedCodec` and validates at the type level that `Brand['Input']` is assignable from `Params` (i.e. the brand's input slot matches the schema's inferred type).

### FR2. Brand co-located with codec

Each parameterized codec defines its `Brand` next to its implementation. Example for pgvector:

```typescript
import type { Vector } from './types/codec-types';

interface VectorBrand extends CodecBrand {
  readonly Output: this['Input'] extends { length: infer N extends number } ? Vector<N> : never;
}

export const pgVectorCodec = parameterizedCodec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  paramsSchema: type({ length: 'number.integer >= 1' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  Brand: undefined as unknown as VectorBrand,
  encode, decode, …
});
```

The `Brand` field is type-only (carrier for `VectorBrand`); the runtime value is `undefined` (cast). This is a single, justified `as unknown as T` cast per codec per the typesafety rules.

### FR3. Standard-Schema JSON codecs

Replace the existing arktype-only `paramsSchema: Type<TParams>` with `paramsSchema: StandardSchemaV1<TParams>`. Add a JSON-codec helper:

```typescript
export const jsonCodec = <S extends StandardSchemaV1>(schema: S) =>
  parameterizedCodec({
    typeId: …,
    paramsSchema: type({ schema: 'unknown' }),  // wraps any standard schema
    renderOutputType: …,                        // typed string from schema
    Brand: <SchemaBrand<S>>,
    …
  });
```

The brand maps `{ schema }` to `StandardSchemaV1.InferOutput<S>` so the no-emit path infers the user's domain type.

### FR4. Single `columnFor` helper

Add `columnFor(codec)` to `@prisma-next/contract-authoring` (or wherever `ColumnTypeDescriptor` lives). Type-discriminated:

```typescript
function columnFor<C extends Codec | ParameterizedCodec>(
  codec: C,
): C extends ParameterizedCodec<infer _Id, infer _T, infer _W, infer _J, infer P, infer _H, infer _B>
  ? <const Params extends P>(params: Params) => ColumnTypeDescriptor & {
      readonly codecId: C['id'];
      readonly typeParams: Params;
    }
  : ColumnTypeDescriptor & { readonly codecId: C['id'] };
```

Pack authors export `columnFor(pgVectorCodec)` as `vector` (or whatever name fits) and stop writing per-codec factories.

### FR5. No-emit `FieldOutputType` rewrite

Rewrite `FieldOutputType` in [`packages/2-sql/2-authoring/contract-ts/src/contract-types.ts`](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts):

```typescript
type FieldOutputType<Definition, M, F> =
  ModelStorageColumn<Definition, M, F> extends infer Col
    ? Col extends { codecId: infer Id; typeParams: infer P }
      ? CodecsForDefinition<Definition>[Id] extends ParameterizedCodec<…, infer Brand>
        ? ApplyNullable<Col, Apply<Brand, P>>
        : ApplyNullable<Col, BaseOutputForCodec<Definition, Id>>
      : Col extends { codecId: infer Id }
        ? ApplyNullable<Col, BaseOutputForCodec<Definition, Id>>
        : never
    : never;
```

Requirements:

- Resolves a column carrying `typeParams: { length: 1536 }` against pgvector to `Vector<1536>`.
- Resolves a column with `typeRef: 'Embedding1536'` to the `storage.types['Embedding1536']`-bound output type.
- Resolves a JSON column with a wrapped Arktype/Zod schema to the schema's inferred type.
- Falls back to the codec's base output type when no `typeParams` are present.
- Preserves nullability handling (existing behaviour).

### FR6. Migrate existing parameterized codecs

Convert the existing optional-fields-on-`Codec` parameterized codecs to `ParameterizedCodec`:

- `pgVectorCodec` (extension `pgvector`)
- Any postgres-core codecs that currently implement `renderOutputType` (`pgNumericCodec`, `pgTimestampCodec`, `pgCharCodec` if present, `pgJsonCodec`, `pgJsonbCodec`).
- Any mongo codecs that implement `renderOutputType`.

Each gets a co-located `Brand`. Their existing per-codec factories are replaced with `columnFor(codec)` exports.

### FR7. Removed: optional fields on base `Codec`

Once FR6 is done, remove `paramsSchema?`, `init?`, and `renderOutputType?` from the base `Codec` interface. They live exclusively on `ParameterizedCodec`. The compiler enforces "either non-parameterized, or fully parameterized" — no half-configured codecs.

## Non-Functional Requirements

- **Typesafety rules** (per `AGENTS.md`): no `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`, no biome suppressions. Type casts minimized; the one `as unknown as Brand` cast per codec is justified by a comment.
- **No backwards-compatibility shims.** The base `Codec` interface drops the parameterization fields; downstream consumers update to use `ParameterizedCodec`. No re-exports or stub fields.
- **Layering**: `Codec` and `ParameterizedCodec` belong at the framework-components layer; `columnFor` belongs in contract authoring. `pnpm lint:deps` passes.
- **Build perf**: type-level brand application must not blow up the no-emit `FieldOutputTypes` evaluation. Acceptance: the existing fixture contract in `packages/2-sql/4-lanes/relational-core/test/fixtures/contract.d.ts` typechecks within the same time budget (±20%) before/after the change. (Measured by running `pnpm --filter @prisma-next/sql-relational-core typecheck` twice.)
- **No global declaration merging.** The brand is co-located on the codec; there is no global `CodecOutputBrands` interface.
- **No in-house JSON Schema → TS converter.** Inference comes from user-provided Standard Schema schemas.

## Non-goals

- **Documentation overhaul of every parameterized codec.** New ones get docs; legacy ones keep theirs unless touched.
- **PSL-side authoring of parameterized types.** Out of scope; this project addresses the TS-authored contract path. PSL parsing of `@vector(length: 1536)` etc. continues to land typeParams on the `ColumnTypeDescriptor` as today.
- **Cross-target codec sharing.** Each target/extension pack continues to ship its own codecs.
- **`ComputeColumnJsType` rework.** That utility already delegates to `ExtractFieldOutputTypes<Contract>`, so it picks up the fix transparently. No changes there beyond verifying the type tests.
- **Runtime validation at column construction.** `columnFor(codec)(params)` validates `params` against `paramsSchema` at construction time; deeper validation (e.g. sanity-checking `typeRef` at column declaration) is out of scope.
- **Removing `Codec.encode?` optionality.** Unrelated to parameterization.
- **Publishing the codec model as a stable external API.** This is internal until pack-author docs land in a follow-up.

# Acceptance Criteria

### A1. `ParameterizedCodec` interface and brand mechanism

- [ ] `ParameterizedCodec<Id, Traits, Wire, Js, Params, Helper, Brand>` exists in framework-components and extends `Codec`.
- [ ] `CodecBrand` and `Apply<B, P>` are defined and exported.
- [ ] `parameterizedCodec({ … })` factory exists and constructs a `ParameterizedCodec`.
- [ ] Type-level test: `Apply<VectorBrand, { length: 1536 }>` evaluates to `Vector<1536>`.
- [ ] Compile error: omitting `paramsSchema`, `renderOutputType`, or `Brand` from `parameterizedCodec({ … })` fails to typecheck.

### A2. Standard-Schema JSON codec

- [ ] `paramsSchema` accepts any `StandardSchemaV1` (Arktype, Zod, others).
- [ ] A JSON codec helper exists that infers the output type from the user-provided schema (wrapped via `StandardSchemaV1.InferOutput<S>`).
- [ ] Type-level test: a JSON column declared with an Arktype schema resolves to the schema's TS type in the no-emit path.

### A3. `columnFor` helper

- [ ] `columnFor(nonParamCodec)` returns a `ColumnTypeDescriptor` directly.
- [ ] `columnFor(paramCodec)(params)` returns a `ColumnTypeDescriptor & { typeParams: Params }` with `Params` literal-preserved.
- [ ] `columnFor(paramCodec)(badParams)` fails to typecheck (params constrained by `Brand['Input']`).
- [ ] Runtime: `columnFor(paramCodec)(params)` validates `params` against `paramsSchema` and throws on failure.

### A4. No-emit `FieldOutputType` resolves brands

- [ ] Type-level test: a column declared as `vector(1536)` (via `columnFor(pgVectorCodec)(...)` or PSL) resolves to `Vector<1536>` in `FieldOutputTypes<Definition>`.
- [ ] Type-level test: a column with `typeRef: 'Embedding1536'` pointing at `storage.types['Embedding1536']: vector(1536)` also resolves to `Vector<1536>`.
- [ ] Type-level test: a JSON column with a wrapped Arktype/Zod schema resolves to the schema's inferred type (matches the existing emit-path behaviour).
- [ ] Type-level test: a non-parameterized column (`text`, `int4`) resolves to the base codec output type, unchanged.
- [ ] Type-level test: nullability is preserved (`Vector<1536> | null` for nullable columns).
- [ ] `ComputeColumnJsType` returns the brand-resolved type for the same fixture columns (verified via `.test-d.ts`).

### A5. Migration of existing parameterized codecs

- [ ] `pgVectorCodec` is converted to `parameterizedCodec({ … })` with a co-located `VectorBrand`.
- [ ] All postgres-core codecs that previously had `renderOutputType?` (numeric, timestamp, json, jsonb, char if present) are converted with co-located brands.
- [ ] Mongo codecs that previously had `renderOutputType?` are converted with co-located brands.
- [ ] Each migrated codec's existing per-extension column factory (e.g. `vector(N)`) is replaced with `columnFor(codec)`.
- [ ] All existing type-level and runtime tests for these codecs pass without functional changes (assertions may tighten where the no-emit path now produces precise types).

### A6. Base `Codec` interface cleanup

- [ ] `paramsSchema?`, `init?`, and `renderOutputType?` are removed from the base `Codec` interface.
- [ ] All callers of these fields go through `ParameterizedCodec`.
- [ ] `pnpm typecheck` passes across the workspace.
- [ ] `pnpm lint:deps` passes (no layering regressions).

### A7. Emit path unchanged

- [ ] `pnpm --filter @prisma-next/emitter-* test` continues to pass; emit-path snapshots for parameterized codecs are byte-identical (the emit path already used `renderOutputType`; nothing changes for it semantically).
- [ ] If an emit-path snapshot must change, the change is justified in a commit message and reviewed.

### A8. Build performance budget

- [ ] `pnpm --filter @prisma-next/sql-relational-core typecheck` runs within ±20% of the pre-change baseline (recorded in this project's `assets/` folder before the cleanup commit).

### A9. Documentation

- [ ] Pack-author guidance: short README section in the package that hosts `parameterizedCodec` and `columnFor`, showing how to author a parameterized codec end-to-end (codec + brand + `columnFor` export).
- [ ] ADR finalised under `docs/architecture docs/adrs/` describing the codec model unification (extends/follows ADR 186); migrated as part of close-out.
- [ ] `docs/architecture docs/subsystems/` entry for codecs updated to mention `ParameterizedCodec` and the brand mechanism.

# Other Considerations

## Security

No new attack surface. `paramsSchema` validation runs on contract construction (already the case for the existing optional `paramsSchema`). User-provided JSON schemas are validated by their own libraries (Arktype/Zod); we do not parse arbitrary JSON Schema strings ourselves.

## Cost

Build-time only. No runtime infra cost.

## Observability

No new metrics. Errors thrown by `columnFor(codec)(params)` validation surface as standard authoring-time errors with the existing error envelope (per `docs/architecture docs/subsystems/error-handling`).

## Data Protection

N/A — type system change.

## Analytics

N/A.

# References

- [ADR 186 — Codec-dispatched type rendering](../../docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) — the emit-path fix and the explicit deferral of the no-emit fix to this work.
- [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — original ticket (we deliberately widened scope from its framing).
- [PR #374 — `feat(operations): author sql operations as TypeScript functions`](https://github.com/prisma/prisma-next/pull/374) — sequenced before this work; introduces `Expression<T>` / `CodecExpression<…>` which consume `FieldOutputTypes<Definition>`.
- [`packages/2-sql/2-authoring/contract-ts/src/contract-types.ts`](../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts) — the no-emit `FieldOutputType` site to be rewritten.
- [`packages/1-framework/1-core/framework-components/src/codec-types.ts`](../../packages/1-framework/1-core/framework-components/src/codec-types.ts) — base `Codec` interface; loses parameterization fields.
- [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`](../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) — SQL `Codec` extension and `codec()` factory; gains `parameterizedCodec()`.
- [`packages/3-extensions/pgvector/src/core/codecs.ts`](../../packages/3-extensions/pgvector/src/core/codecs.ts) and [`packages/3-extensions/pgvector/src/exports/column-types.ts`](../../packages/3-extensions/pgvector/src/exports/column-types.ts) — first migration target.
- [`packages/3-extensions/pgvector/src/types/codec-types.ts`](../../packages/3-extensions/pgvector/src/types/codec-types.ts) — `Vector<N>` branded type; `VectorBrand` will live alongside the codec.
- [Standard Schema spec](https://github.com/standard-schema/standard-schema) — used for JSON-codec inference.

# Open Questions

1. **Where does `parameterizedCodec()` live?**
   The `codec()` factory currently lives in `@prisma-next/sql-relational-core/ast` (SQL-specific). `parameterizedCodec()` is conceptually framework-level (Mongo also benefits). **Default**: add `parameterizedCodec()` to `@prisma-next/framework-components` with the SQL/Mongo-specific factories thinly wrapping it to add their family-specific fields (`meta`, `paramsSchema` arktype constraint relaxed to `StandardSchemaV1`, etc.). Override only if the layering rules forbid it.

2. **`codec()` vs `parameterizedCodec()` in the SQL-family factory.**
   Should `codec()` continue to accept `paramsSchema` etc. as optional today, or should every parameterized codec move to `parameterizedCodec()` immediately? **Default**: hard-cut. Once FR6 lands, `codec()` no longer accepts the parameterization fields. Avoids a long deprecation window.

3. **Brand storage: declared field vs phantom type slot.**
   `readonly Brand: BrandType` requires `as unknown as BrandType` at construction. Alternative: a **type-only slot** like `_brand?: BrandType` that's never read at runtime and is `undefined` by default — same pattern as TS phantom brands. **Default**: declared `readonly Brand` carrying a value cast (single, justified `as unknown as T`), because the codec object is the canonical place to colocate the brand and we want autocomplete to surface it.

4. **`columnFor` name.**
   `columnFor(pgVectorCodec)` reads OK. Alternatives: `column(pgVectorCodec)`, `c(pgVectorCodec)` (terser), `from(pgVectorCodec)`. **Default**: `columnFor`. Pack authors typically re-export under a domain name (`vector`, `embedding`) so the helper name is mostly used at the export site.

5. **JSON-codec API surface.**
   Should the JSON-codec helper accept the schema directly (`jsonCodec(schema)`) or as a typeParam (`jsonCodec({ schema })`)? **Default**: as a typeParam (`{ schema }`) so it round-trips cleanly through `storage.types` (a named instance is just `jsonCodec({ schema: mySchema })` — same surface as `vector({ length: 1536 })`).

6. **`storage.types` vs `typeRef` clarification in docs.**
   These two have caused confusion in design discussions. **Default**: add a short clarifying paragraph to the codecs subsystem doc as part of A9 documentation: `storage.types` is the **registry** of named parameterized type instances on the contract; `typeRef` is the **column property** that points to a registry entry by name. Inline `typeParams` and `typeRef` are mutually exclusive.

7. **`renderOutputType` taking `Record<string, unknown>` today.**
   The current runtime signature is loose. After FR6, every `renderOutputType` is typed as `(params: Params) => string`. Should the base `Codec` interface still expose a runtime-string `renderOutputType` for emitters that don't want to type-narrow? **Default**: no. Emitters look the codec up in the registry; if it's a `ParameterizedCodec` they call `renderOutputType(params)`. The registry returns `Codec | ParameterizedCodec` and emitters narrow.
