# `@prisma-next/extension-arktype-json`

Per-library JSON-with-schema column factory for Prisma Next, built on
[arktype](https://arktype.io). Ships the `arktypeJson(schema)` column-author
helper and the `arktype/json@1` codec descriptor.

## What it does

Given an arktype `Type`, `arktypeJson(schema)` produces a column descriptor
that:

- Stores values as `jsonb` on Postgres.
- Eagerly serializes `schema.expression` (TypeScript-source-like rendering)
  and `schema.json` (arktype's internal IR) into `typeParams`. The IR is the
  lossless rehydration source; the expression is the emit-path renderer's
  input.
- At runtime, the framework's unified codec descriptor map rehydrates the
  schema via `ark.schema(typeParams.jsonIr)` and returns a `Codec` whose
  `decode` validates wire payloads via the rehydrated schema. Validation
  failures throw `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`.
- The emitter renders the column's TS type as the schema's `expression`
  (e.g. `{ name: string; price: number }`).

## Why a per-library extension

The unified `CodecDescriptor` model routes JSON-with-schema through per-
library extension packages: arktype-json now, future zod / valibot
extensions when each has a clean serialize / rehydrate story. The Postgres
adapter retains only the storage-level `jsonColumn` / `jsonbColumn`
descriptors (untyped raw JSON). See [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).

## Usage

```ts
import { type } from 'arktype';
import { arktypeJson } from '@prisma-next/extension-arktype-json/column-types';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';

const ProductSchema = type({ name: 'string', price: 'number', 'description?': 'string' });

const contract = defineContract({ /* ... */ }, ({ field, model }) => ({
  models: {
    Product: model('Product', {
      fields: {
        id: field.id.uuidv4(),
        spec: field.column(arktypeJson(ProductSchema)),
        //                  ^? Type<{ name: string; price: number; description?: string }>
      },
    }).sql({ table: 'product' }),
  },
}));
```

In the emitted `contract.d.ts`, `Product.spec` resolves to
`{ name: string; price: number; description?: string }` — the schema's
expression renders directly into the field type.

> **No-emit caveat.** Today, importing the TS contract directly without
> running `pnpm emit` resolves `Product.spec` to `unknown` (the codec's
> base `output` type). The schema's inferred shape only flows into the
> field type after emit. Parameterized no-emit resolution is tracked
> under TML-2357 — see [ADR 208 § No-emit type resolution](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).

## Pack registration

Add the runtime descriptor to your runtime stack and the control descriptor
to your `prisma-next.config.ts` `extensionPacks`:

```ts
import arktypeJsonPack from '@prisma-next/extension-arktype-json/pack';
import arktypeJsonRuntime from '@prisma-next/extension-arktype-json/runtime';

// prisma-next.config.ts
export default {
  extensionPacks: { arktypeJson: arktypeJsonPack },
  // ...
};

// runtime
const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  extensionPacks: [arktypeJsonRuntime],
});
```

## Compatibility

Codec stability depends on a round-trip invariant: `ark.schema(typeParams.jsonIr).expression === typeParams.expression`. The emit-path renderer reads `expression` directly, so a contract emitted against arktype `X` and rehydrated against arktype `Y` produces correct types only as long as that invariant holds across `X→Y`.

The package's `arktype` dependency is pinned to a tilde range (`~2.1.29`) — patch upgrades are accepted, minor and major upgrades are not. Bumping the range without a coordinated re-emit of every contract using `arktype/json@1` risks emit-path output going stale relative to the rehydrated runtime schema. Consumers who upgrade `arktype` outside this range should re-run `pnpm emit` and verify `contract.d.ts` matches expectations.

The runtime enforces the invariant defensively: the codec's factory runs at execution-context construction time (typically when `runtime.connect()` is called), and throws `RUNTIME.TYPE_PARAMS_INVALID` if the rehydrated schema's `expression` doesn't match the serialized one. So a stale-but-shape-valid `contract.json` fails fast at startup rather than rendering wrong types in user code. The error message points at re-running `pnpm emit`.

## Notes

- The codec is library-bound (`arktype/json@1`), not target-bound. Other
  schema libraries ship as parallel extensions (`zod/json@1`,
  `valibot/json@1`) when their serialize/rehydrate stories materialize.
- `decode` validates internally and throws on rejection; the framework's
  `JsonSchemaValidatorRegistry` is not consulted for arktype-json columns
  (no `'json-validator'` trait + per-instance `validate` extraction). The
  one-path "validate inside `decode`" matches the spec's Case J pinning.
- For untyped raw JSON columns, use `jsonColumn` / `jsonbColumn` from
  `@prisma-next/adapter-postgres/column-types` instead.
