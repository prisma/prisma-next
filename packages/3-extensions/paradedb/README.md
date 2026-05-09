# @prisma-next/extension-paradedb

ParadeDB full-text search extension pack for Prisma Next.

## Overview

This extension pack registers a `'bm25'` index type with the SQL family's index-type registry, so contracts can author BM25 full-text search indexes via the standard `constraints.index(...)` surface and the Postgres adapter emits `CREATE INDEX ... USING bm25 WITH (...)` DDL.

The v1 surface covers the `key_field` storage parameter only. Per-field tokenizer and column configuration is deferred to expression-index support.

## Responsibilities

- **bm25 index registration**: declares a `'bm25'` entry via `defineIndexTypes()` carrying an arktype validator for the bm25 options shape
- **Extension descriptor**: declares the `paradedb/bm25` capability for contract-level feature detection
- **Pack ref export**: ships a pure `/pack` entrypoint for TypeScript contract authoring

## Dependencies

- **`@prisma-next/sql-contract`**: index-type registry primitive
- **`@prisma-next/contract`** / **`@prisma-next/contract-authoring`**: core contract types
- **`arktype`**: option-shape validation

## Installation

```bash
pnpm add @prisma-next/extension-paradedb
```

## Usage

### Contract definition

Author bm25 indexes via the standard `constraints.index(...)` surface; the registered `'bm25'` entry narrows `options` per-`type`:

```typescript
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import paradedb from '@prisma-next/extension-paradedb/pack';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensionPacks: { paradedb },
  models: {
    Item: model('Item', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'items',
      indexes: [
        constraints.index([cols.body], {
          name: 'item_body_bm25_idx',
          type: 'bm25',
          options: { key_field: 'id' },
        }),
      ],
    })),
  },
});
```

### key_field

ParadeDB BM25 indexes require a `key_field` — a unique column that identifies each document. It is required, must be a string, and is typically (but not always) the table's primary key.

## Capabilities

- `paradedb/bm25` — indicates support for BM25 full-text search indexes

## Not yet implemented

- Per-column / per-expression tokenizer configuration (deferred to expression-index support)
- `@@@` operator and `pdb.*` query builder functions
- `CREATE EXTENSION pg_search` via migration planner
- Scoring, aggregation, and highlight functions

## References

- [ParadeDB documentation](https://docs.paradedb.com/)
- [ParadeDB CREATE INDEX](https://docs.paradedb.com/documentation/indexing/create-index)
- [ADR 210 — Index-type registry](../../../docs/architecture%20docs/adrs/ADR%20210%20-%20Index-type%20registry.md)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
