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

The codec-registry-unification spec routes JSON-with-schema through per-
library extension packages: arktype-json now, future zod / valibot
extensions when each has a clean serialize / rehydrate story. The Postgres
adapter retains only the storage-level `jsonColumn` / `jsonbColumn`
descriptors (untyped raw JSON). See [spec § Case J](../../../wip/codec-registry-unification/spec.md).

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
