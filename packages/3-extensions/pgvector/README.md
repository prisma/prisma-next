# @prisma-next/extension-pgvector

PostgreSQL pgvector extension pack for Prisma Next.

## Overview

This extension pack adds support for the `vector` data type and vector similarity operations (e.g., cosine distance) for PostgreSQL databases with the pgvector extension installed.

## Responsibilities

- **Vector Codec**: Provides codec for `pg/vector@1` mapping to `number[]` at runtime, and a `Vector<N>` type for dimensioned typing in `contract.d.ts`
- **Vector Operations**: Registers vector similarity operations (e.g., `cosineDistance`) for use in queries
- **CLI Integration**: Provides extension descriptor for `prisma-next.config.ts` configuration
- **Runtime Extension**: Registers codecs and operations at runtime for vector column operations
- **Pack Ref Export**: Ships a pure `/pack` entrypoint for TypeScript contract authoring without runtime filesystem access
- **Database Dependencies**: Declares the `vector` Postgres extension as a database dependency, which the migration planner emits as a `CREATE EXTENSION IF NOT EXISTS vector` operation and the verifier checks against the schema IR

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

The pgvector extension declares its database requirements as component-owned database dependencies. When using the `prisma-next db init` command, the migration planner automatically includes a `CREATE EXTENSION IF NOT EXISTS vector` operation.

For manual database setup, ensure the pgvector extension is installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The verifier will check for the presence of the `vector` extension in your database schema and report an error if it's missing.

## Configuration

Add the extension to your `prisma-next.config.ts`:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [pgvector],
});
```

## Usage

### Contract Definition

Add vector columns to your contract and enable the namespace via pack refs:

```typescript
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import postgres from '@prisma-next/target-postgres/pack';

type AllCodecTypes = CodecTypes & PgVectorCodecTypes;

export const contract = defineContract<AllCodecTypes>()
  .target(postgres)
  .extensionPacks({ pgvector })
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('embedding', { type: vectorColumn, nullable: true })
      .primaryKey(['id']),
  )
  .build();
```

### Runtime Setup

Register the extension when creating your execution stack:

```typescript
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';

const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  extensionPacks: [pgvector],
});
const context = createExecutionContext({ contract, stack });
const stackInstance = instantiateExecutionStack(stack);
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

The extension provides:

- `CodecTypes` mapping the `pg/vector@1` type ID to `number[]` (runtime representation)
- `Vector<N>` type for dimensioned vector typing in emitted `contract.d.ts` and schema result types when the contract includes dimension metadata

```typescript
import type { CodecTypes, Vector } from '@prisma-next/extension-pgvector/codec-types';

// CodecTypes['pg/vector@1']['output'] = number[]
// Vector<1536> is a branded number[] type used for dimensioned typing
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

Pack refs (`@prisma-next/extension-pgvector/pack`) are pure data objects generated from the hydrated manifest (`src/core/manifest.ts`), so TypeScript contract builders can enable the pgvector namespace in both emit and no-emit workflows without touching the filesystem.

