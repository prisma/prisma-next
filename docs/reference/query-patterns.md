# Query Patterns

This document covers standard patterns for working with Prisma Next queries, including table access, type inference, and common usage patterns.

## Keep a single `db.ts` entrypoint

**Standard Practice**: Keep one `db.ts` entrypoint that creates `db` once via `postgres(...)`, then import `db` in query modules.

**✅ CORRECT: Build `db` in one file**

```typescript
// src/prisma/db.ts
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
```

**Why?**
- One obvious runtime entrypoint for app code
- Keeps static query roots and runtime boundary together (`db.runtime()`)
- Reduces drift from re-exported aliases as surfaces evolve

## Import and use `db`

**Pattern**: Import `db` directly and optionally extract table/column locals for reuse.

**✅ CORRECT: Direct access (shorter, more readable)**

```typescript
import { db } from '../prisma/db';

const plan = db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();
```

**✅ CORRECT: Extract variables for reuse (common pattern)**

```typescript
import { db } from '../prisma/db';

const userTable = db.schema.tables.user;
const userColumns = userTable.columns;

const plan = db.sql
  .from(userTable)
  .select({ id: userColumns.id, email: userColumns.email })
  .build();
```

**When to extract variables:**
- When the same table/columns are used multiple times in a function
- When it improves readability (e.g., long column paths)
- When you want to reuse the same table reference across multiple queries

**When to use direct access:**
- Single-use queries
- When the path is short and clear
- When you want to keep code concise

## Type Inference with `ResultType`

**Pattern**: Use `ResultType<typeof plan>` to extract row types from plans.

**✅ CORRECT: Extract row type from plan**

```typescript
import { db } from '../prisma/db';
import type { ResultType } from '@prisma-next/sql-query/types';

const plan = db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();

type UserRow = ResultType<typeof plan>;  // { id: number; email: string }
```

**✅ CORRECT: Extract type before execution**

```typescript
const plan = db.sql
  .insert(db.schema.tables.user, { email: param('email') })
  .returning(db.schema.tables.user.columns.id, db.schema.tables.user.columns.email)
  .build({ params: { email: 'alice@example.com' } });

type InsertRow = ResultType<typeof plan>;  // { id: number; email: string }
const result = await collectRows<InsertRow>(plan);
```

**Why?**
- Type-safe: TypeScript infers the exact row type from the plan
- No manual type definitions needed
- Works with all query types (SELECT, INSERT, UPDATE, DELETE)
- Preserves nullability and nested types

## Common Patterns

### DML Operations with Returning

```typescript
import { db } from '../prisma/db';
import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = db.schema.tables.user;
const userColumns = userTable.columns;

// Insert with returning
const insertPlan = db.sql
  .insert(userTable, { email: param('email') })
  .returning(userColumns.id, userColumns.email)
  .build({ params: { email: 'alice@example.com' } });

type InsertRow = ResultType<typeof insertPlan>;
const result = await collectRows<InsertRow>(insertPlan);
```

### Queries with Joins

```typescript
import { db } from '../prisma/db';
import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = db.schema.tables.user;
const postTable = db.schema.tables.post;

const plan = db.sql
  .from(userTable)
  .innerJoin(postTable, (on) => on.eqCol(userTable.columns.id, postTable.columns.userId))
  .where(userTable.columns.active.eq(param('active')))
  .select({
    userId: userTable.columns.id,
    postId: postTable.columns.id,
    title: postTable.columns.title,
  })
  .build({ params: { active: true } });

type JoinedRow = ResultType<typeof plan>;
```

### Queries with includeMany

```typescript
import { db } from '../prisma/db';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = db.schema.tables.user;
const postTable = db.schema.tables.post;

const plan = db.sql
  .from(userTable)
  .includeMany(
    postTable,
    (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
    (child) =>
      child
        .select({
          id: postTable.columns.id,
          title: postTable.columns.title,
        })
        .orderBy(postTable.columns.createdAt.desc()),
    { alias: 'posts' },
  )
  .select({
    id: userTable.columns.id,
    email: userTable.columns.email,
    posts: true,
  })
  .build();

type UserWithPosts = ResultType<typeof plan>;
```

## ORM Lane Patterns

**Pattern**: Use ORM lane for model-centric queries with relation traversal and base-model writes.

**✅ CORRECT: ORM entrypoint with model registry**

```typescript
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
const o = db.orm;

// Model registry proxy: orm.user(), orm.post(), etc.
const builder = o.user();
```

**✅ CORRECT: Read operations with chained methods**

```typescript
const plan = o.user()
  .where((u) => u.id.eq(param('userId')))
  .orderBy((u) => u.createdAt.desc())
  .take(10)
  .select((u) => ({
    id: u.id,
    email: u.email,
  }))
  .findMany({
    params: { userId: 123 },
  });
```

**✅ CORRECT: Relation filters**

```typescript
// Find users who have at least one matching post
const plan = o.user()
  .where.related.posts.some((p) => p.where((m) => m.id.eq(param('postId'))))
  .select((u) => ({
    id: u.id,
    email: u.email,
  }))
  .take(100)
  .findMany({
    params: { postId: 1 },
  });
```

**✅ CORRECT: Includes with child builder**

```typescript
const plan = o.user()
  .include.posts((child) =>
    child
      .where((m) => m.id.eq(param('postId')))
      .select((m) => ({
        id: m.id,
        title: m.title,
        createdAt: m.createdAt,
      }))
      .orderBy((m) => m.createdAt.desc()),
  )
  .select((u) => ({
    id: u.id,
    email: u.email,
    posts: true,
  }))
  .take(10)
  .findMany({
    params: { postId: 1 },
  });
```

**✅ CORRECT: Write operations**

```typescript
// Create
const createPlan = o.user().create({
  email: 'alice@example.com',
  name: 'Alice',
});

// Update
const updatePlan = o.user().update(
  (u) => u.id.eq(param('userId')),
  { email: 'newemail@example.com' },
  { params: { userId: 1 } },
);

// Delete
const deletePlan = o.user().delete(
  (u) => u.id.eq(param('userId')),
  { params: { userId: 1 } },
);
```

**Key Points:**
- ORM lane compiles to SQL lane primitives (EXISTS subqueries, includeMany, DML operations)
- Model registry proxy provides discoverable entrypoint (`orm.user()`, `orm.post()`)
- Relation filters compile to EXISTS/NOT EXISTS subqueries
- Includes compile to SQL lane `includeMany()` (capability-gated: requires `lateral: true` and `jsonAgg: true`)
- Writes use model-to-column mapping from contract mappings
- All ORM plans have `meta.lane = 'orm'` and appropriate annotations

## Anti-Patterns

**❌ WRONG: Don't create extra aliases for one-off usage**

```typescript
import { db } from '../prisma/db';

const userTable = db.schema.tables.user;
const userColumns = userTable.columns;
const plan = db.sql
  .from(userTable)
  .select({ id: userColumns.id })
  .build();
```

**❌ WRONG: Don't create intermediate variables unnecessarily**

```typescript
// Don't extract variables for single-use queries
const tables = schema.tables;  // Unnecessary
const userTable = tables.user;  // Unnecessary
const userColumns = userTable.columns;  // Unnecessary

const plan = sql
  .from(userTable)  // Only used once
  .select({ id: userColumns.id })
  .build();
```

**✅ CORRECT: Use direct access for single-use queries**

```typescript
const plan = sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .build();
```

## Summary

1. **Use one `db.ts` entrypoint** for config and runtime boundary
2. **Import `db` directly** in query modules
3. **Extract variables** when tables/columns are reused multiple times
4. **Use `ResultType<typeof plan>`** to extract row types from plans
5. **Use direct access** for single-use queries to keep code concise
6. **Use ORM lane** for model-centric queries with relation traversal and base-model writes
7. **ORM entrypoint** uses model registry proxy (`orm.<model>()`) for discoverability
8. **Relation filters** use `where.related.<relation>.some/none/every(predicate)` pattern
9. **Includes** use `include.<relation>(child => ...)` pattern with capability gating
10. **Writes** use `create(data)`, `update(where, data)`, `delete(where)` with model-to-column mapping
