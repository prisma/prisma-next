# @prisma-next/extension-paradedb

ParadeDB full-text search extension pack for Prisma Next.

## Overview

This extension pack adds support for [ParadeDB](https://docs.paradedb.com/) BM25 full-text search indexes in the contract authoring layer. It enables declarative definition of BM25 indexes with per-field tokenizer configuration, so that `contract.json` and `contract.d.ts` carry the full search schema.

This is the **contract-only foundation**. Query-plane support (`@@@` operator, `pdb.*` functions) and migration-plane support (`CREATE INDEX ... USING bm25` DDL generation) are planned as follow-up work.

## Responsibilities

- **BM25 Index Authoring**: Typed `bm25.*` field builders for defining BM25 indexes in `contract.ts`
- **Tokenizer Catalog**: `TokenizerId` type union covering all 12 built-in ParadeDB tokenizers
- **Extension Descriptor**: Declares `paradedb/bm25` capability for contract-level feature detection
- **Pack Ref Export**: Ships a pure `/pack` entrypoint for TypeScript contract authoring

## Dependencies

- **`@prisma-next/contract`**: Core contract types
- **`@prisma-next/contract-authoring`**: Column type descriptor interface
- **`@prisma-next/sql-contract`**: SQL contract IR types (`Bm25FieldConfig`, `Index`)

## Installation

```bash
pnpm add @prisma-next/extension-paradedb
```

## Usage

### Contract Definition

Define BM25 indexes on your tables using the `bm25` field builders:

```typescript
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn, jsonbColumn } from '@prisma-next/adapter-postgres/column-types';
import { bm25 } from '@prisma-next/extension-paradedb/index-types';
import paradedb from '@prisma-next/extension-paradedb/pack';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract()
  .target(postgres)
  .extensionPacks({ paradedb })
  .table('items', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('description', { type: textColumn, nullable: false })
      .column('category', { type: textColumn, nullable: false })
      .column('rating', { type: int4Column, nullable: false })
      .column('metadata', { type: jsonbColumn, nullable: false })
      .primaryKey(['id'])
      .bm25Index({
        // keyField auto-inferred from single-column PK ('id')
        fields: [
          bm25.text('description', { tokenizer: 'simple', stemmer: 'english' }),
          bm25.text('category'),
          bm25.numeric('rating'),
          bm25.json('metadata', { tokenizer: 'ngram', min: 2, max: 3 }),
        ],
        name: 'search_idx',
      }),
  )
  .build();
```

### Field Builders

The `bm25` namespace provides typed field builders that produce `Bm25FieldConfig` objects:

| Builder | Description | Tokenizer support |
|---------|-------------|-------------------|
| `bm25.text(column, opts?)` | Text field (`text`, `varchar`) | Yes — any tokenizer + stemmer, remove_emojis |
| `bm25.numeric(column)` | Numeric field (filterable, sortable) | No |
| `bm25.boolean(column)` | Boolean field | No |
| `bm25.json(column, opts?)` | JSON/JSONB field | Yes — tokenizer + ngram params |
| `bm25.datetime(column)` | Timestamp/date field | No |
| `bm25.range(column)` | Range field | No |
| `bm25.expression(sql, opts)` | Raw SQL expression | Yes — `alias` required |

### Expression-Based Fields

For computed or JSON sub-field indexing, use `bm25.expression()` with a raw SQL string:

```typescript
.bm25Index({
  fields: [
    bm25.text('description'),
    bm25.expression("description || ' ' || category", {
      alias: 'concat',
      tokenizer: 'simple',
    }),
    bm25.expression("(metadata->>'color')", {
      alias: 'meta_color',
      tokenizer: 'ngram',
      min: 2,
      max: 3,
    }),
  ],
})
```

### keyField Behavior

ParadeDB BM25 indexes require a `key_field` — a unique column that identifies each document:

- **Auto-inferred**: When `keyField` is omitted, it's resolved from the table's single-column primary key at `build()` time.
- **Explicit override**: Set `keyField` to use a non-PK unique column.
- **Error**: If the table has a composite PK or no PK and `keyField` is omitted, `build()` throws.

```typescript
// Auto-inferred from PK
.bm25Index({ fields: [bm25.text('body')] })

// Explicit override
.bm25Index({ keyField: 'uuid', fields: [bm25.text('body')] })
```

## Tokenizers

All 12 built-in ParadeDB tokenizers are available via the `TokenizerId` type:

| Tokenizer | Description |
|-----------|-------------|
| `unicode` | Default. Unicode word boundaries (UAX #29). Lowercases. |
| `simple` | Splits on non-alphanumeric. Lowercases. |
| `ngram` | Character n-grams of configurable length. |
| `icu` | ICU Unicode standard segmentation. Multilingual. |
| `regex_pattern` | Regex-based tokenization. |
| `source_code` | camelCase / snake_case splitting. |
| `literal` | No splitting. Exact match, sort, aggregation. |
| `literal_normalized` | Literal + lowercase + token filters. |
| `whitespace` | Whitespace splitting + lowercase. |
| `chinese_compatible` | CJK-aware word segmentation. |
| `jieba` | Chinese segmentation via Jieba. |
| `lindera` | Japanese/Korean/Chinese via Lindera. |

## Capabilities

The extension declares:

- `paradedb/bm25`: Indicates support for BM25 full-text search indexes

## Not Yet Implemented

The following are planned for follow-up work:

- **Query plane**: `@@@` operator support in the sql-orm query builder
- **Query plane**: `pdb.*` query builder functions (match, term, phrase, fuzzy, etc.)
- **Migration plane**: `CREATE INDEX ... USING bm25` DDL generation from contract diffs
- **Runtime**: Scoring, aggregation, and highlight functions
- **Database dependencies**: `CREATE EXTENSION pg_search` via migration planner

## References

- [ParadeDB documentation](https://docs.paradedb.com/)
- [ParadeDB CREATE INDEX](https://docs.paradedb.com/documentation/indexing/create-index)
- [ParadeDB Tokenizers](https://docs.paradedb.com/documentation/tokenizers/overview)
- [pg_search source](https://github.com/paradedb/paradedb/tree/main/pg_search)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
- [Project spec](../../../projects/parade-db-core/spec.md)
