# @prisma-next/extension-pgvector

PostgreSQL pgvector extension pack for Prisma Next.

## Overview

This extension pack adds support for the `vector` data type and vector similarity operations (e.g., cosine distance) for PostgreSQL databases with the pgvector extension installed.

## Responsibilities

- **Vector Codec**: Provides codec for `pg/vector@1` type ID mapping to `number[]` JavaScript type
- **Vector Operations**: Registers vector similarity operations (e.g., `cosineDistance`) for use in queries
- **CLI Integration**: Provides extension descriptor for `prisma-next.config.ts` configuration
- **Runtime Extension**: Registers codecs and operations at runtime for vector column operations

## Dependencies

- **`@prisma-next/cli`**: CLI config types and extension descriptor interface
- **`@prisma-next/sql-operations`**: SQL operation signature types
- **`@prisma-next/sql-relational-core`**: Codec registry and AST types
- **`arktype`**: Schema validation for manifest structure

## Installation

```bash
pnpm add @prisma-next/extension-pgvector
```

## Database Setup

Before using this extension, ensure the pgvector extension is installed in your PostgreSQL database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Configuration

Add the extension to your `prisma-next.config.ts`:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import pgvector from '@prisma-next/extension-pgvector/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [pgvector],
});
```

## Usage

### Contract Definition

Add vector columns to your contract:

```typescript
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';

type AllCodecTypes = CodecTypes & PgVectorCodecTypes;

export const contract = defineContract<AllCodecTypes>()
  .target('postgres')
  .table('post', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('title', { type: 'pg/text@1', nullable: false })
      .column('embedding', { type: 'pg/vector@1', nullable: true })
      .primaryKey(['id']),
  )
  .build();
```

### Runtime Setup

Register the extension when creating your runtime context:

```typescript
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';

const adapter = createPostgresAdapter();
const context = createRuntimeContext({
  contract,
  adapter,
  extensions: [pgvector()],
});
```

### Query Usage

Use vector similarity operations in your queries:

```typescript
import { sql, tables } from '../prisma/query';
import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';

const queryVector = [0.1, 0.2, 0.3, /* ... */];

const plan = sql
  .from(tables.post)
  .select({
    id: tables.post.columns.id,
    title: tables.post.columns.title,
    distance: tables.post.columns.embedding.cosineDistance(param('queryVector')),
  })
  .orderBy(tables.post.columns.embedding.cosineDistance(param('queryVector')).asc())
  .limit(10)
  .build({ params: { queryVector } });

type Row = ResultType<typeof plan>;
```

## Types

### Codec Types

The extension provides a `CodecTypes` export mapping the `pg/vector@1` type ID to `number[]`:

```typescript
import type { CodecTypes } from '@prisma-next/extension-pgvector/codec-types';

// CodecTypes['pg/vector@1']['output'] = number[]
```

### Operation Types

The extension provides an `OperationTypes` export for vector operations:

```typescript
import type { OperationTypes } from '@prisma-next/extension-pgvector/operation-types';

// OperationTypes['pg/vector@1']['cosineDistance'] = (rhs: number[] | vector) => number
```

## Operations

### cosineDistance

Computes the cosine distance between two vectors.

**Signature**: `cosineDistance(rhs: number[] | vector): number`

**SQL**: Uses the pgvector `<=>` operator: `1 - (vector1 <=> vector2)`

**Example**:
```typescript
const distance = tables.post.columns.embedding.cosineDistance(param('queryVector'));
```

## Capabilities

The extension declares the following capabilities:

- `pgvector/cosine`: Indicates support for cosine distance operations

## References

- [pgvector documentation](https://github.com/pgvector/pgvector)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
- [Extension Packs Guide](../../../docs/reference/Extension-Packs-Naming-and-Layout.md)

