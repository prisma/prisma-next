# @prisma-next/extension-arktype-json

Per-library JSON-with-schema extension for Prisma Next using [arktype](https://arktype.io/) for schema definition, validation, and lossless serialize/rehydrate.

## Overview

This extension pack adds support for JSON columns whose payload is validated against an arktype schema. The schema is defined at the column-author site in TypeScript, eagerly serialized into the contract's storage description, and rehydrated at runtime so the codec's `decode` validates wire payloads internally — no separate validator registry consultation.

The codec id is **library-bound** (`arktype/json@1`), not target-bound. Future per-library JSON extensions (zod, valibot) will ship as parallel packages with their own codec ids and serialize/rehydrate pipelines.

## Responsibilities

- **`arktypeJson(schema)` column author surface**: returns a `ColumnTypeDescriptor` with eagerly extracted typeParams and a curried codec factory whose return type carries the schema's inferred output via `S['infer']`.
- **`arktypeJsonCodec` framework descriptor**: registers the curried factory with the framework. `factory(params)(ctx)` rehydrates the schema from the serialized IR, returning a `Codec` whose `decode` validates internally.
- **`renderOutputType`**: emits the schema's TypeScript-source-like expression into `contract.d.ts` so the JSON column's column type renders accurately.

## Dependencies

- **`@prisma-next/contract-authoring`**: column type descriptor surface.
- **`@prisma-next/framework-components`**: codec descriptor and Ctx types.
- **`@prisma-next/sql-runtime`**: extension descriptor shape.
- **`arktype`**: schema definition, validation, and serialize/rehydrate pipeline.

## Installation

```bash
pnpm add @prisma-next/extension-arktype-json arktype
```

## Usage

```ts
import { type } from 'arktype';
import { arktypeJson } from '@prisma-next/extension-arktype-json/column-types';

const ProductSchema = type({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

// Column-author site
const productColumn = arktypeJson(ProductSchema);
// productColumn.codecId === 'arktype/json@1'
// productColumn.nativeType === 'jsonb'
// productColumn.typeParams === { expression: '{ name: string, price: number, description?: string }', jsonIr: <arktype ir> }
// productColumn.type :: (ctx: Ctx) => Codec<'arktype/json@1', readonly ['equality'], string, { name: string; price: number; description?: string }>
```

## Architecture

- **Serialization**: `schema.expression` (TypeScript-source string) for the emit-path renderer; `schema.json` (arktype's internal IR) for runtime rehydration. The IR is the lossless wire format; `expression` is the human-readable rendering.
- **Rehydration**: `ark.schema(typeParams.jsonIr)` produces a callable `Type` whose `~standard` interface drives validation in the codec's `decode` body.
- **Validation**: failed validation throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` with `ArkErrors` summary as the issues payload.

See [ADR 205 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) and the [codec-registry-unification spec](../../../projects/codec-registry-unification/spec.md) (§ Case J — JSON-with-schema) for the design rationale.
