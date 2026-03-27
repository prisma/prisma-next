# @prisma-next/sql-lane-sql-builder-new

Type-safe SQL query builder for Prisma Next with runtime execution.

## Usage

```typescript
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';

const db = postgres<Contract>({ contractJson, url: process.env['DATABASE_URL']! });
const tables = db.schema.tables;

// SELECT with WHERE
const user = await db.sql
  .from(tables.user)
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.id, 1))
  .first();

// JOIN
const rows = await db.sql
  .from(tables.user)
  .innerJoin(tables.post, (f, fns) => fns.eq(f.user.id, f.post.user_id))
  .select('name', 'title')
  .all();

// GROUP BY with aggregate
const counts = await db.sql
  .from(tables.post)
  .select('user_id')
  .select('cnt', (_f, fns) => fns.count())
  .groupBy('user_id')
  .having((_f, fns) => fns.gt(fns.count(), 1))
  .all();
```

## Dependencies

- `@prisma-next/sql-relational-core` — AST nodes, execution context, query operation registry
- `@prisma-next/sql-runtime` — Runtime type for query execution

## Architecture

- **Domain:** SQL
- **Layer:** Lanes
- **Plane:** Runtime

## Status

See [STATUS.md](./STATUS.md) for covered clauses and known gaps.
