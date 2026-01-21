# Query Patterns

This document covers standard patterns for working with Prisma Next queries, including table access, type inference, and common usage patterns.

## Export `tables` from `query.ts`

**Standard Practice**: Always export `tables` from your `query.ts` file as a convenience export for better developer experience.

**✅ CORRECT: Export tables from query.ts**

```typescript
// src/prisma/query.ts
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql as sqlBuilder } from '@prisma-next/sql-lane/sql';
import { createExecutionStack, instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);
const stack = createExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensionPacks: [] });
const stackInstance = instantiateExecutionStack(stack);
const context = createExecutionContext({ contract, stackInstance });

export const sql = sqlBuilder<Contract>({ context });
export const schema = schemaBuilder<Contract>(context);
export const tables = schema.tables;  // Convenience export
```

**Why?**
- Shorter, more readable: `tables.user` instead of `schema.tables.user`
- Consistent pattern across the codebase
- Better DX: less nesting, easier to type
- Users naturally expect this pattern

## Import and Use `tables`

**Pattern**: Import `tables` directly from `query.ts` and optionally extract table/column variables for reuse.

**✅ CORRECT: Direct access (shorter, more readable)**

```typescript
import { sql, tables } from '../prisma/query';

const plan = sql
  .from(tables.user)
  .select({ id: tables.user.columns.id, email: tables.user.columns.email })
  .build();
```

**✅ CORRECT: Extract variables for reuse (common pattern)**

```typescript
import { sql, tables } from '../prisma/query';

const userTable = tables.user;
const userColumns = userTable.columns;

const plan = sql
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
import { sql, tables } from '../prisma/query';
import type { ResultType } from '@prisma-next/sql-query/types';

const plan = sql
  .from(tables.user)
  .select({ id: tables.user.columns.id, email: tables.user.columns.email })
  .build();

type UserRow = ResultType<typeof plan>;  // { id: number; email: string }
```

**✅ CORRECT: Extract type before execution**

```typescript
const plan = sql
  .insert(tables.user, { email: param('email') })
  .returning(tables.user.columns.id, tables.user.columns.email)
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
import { sql, tables } from '../prisma/query';
import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = tables.user;
const userColumns = userTable.columns;

// Insert with returning
const insertPlan = sql
  .insert(userTable, { email: param('email') })
  .returning(userColumns.id, userColumns.email)
  .build({ params: { email: 'alice@example.com' } });

type InsertRow = ResultType<typeof insertPlan>;
const result = await collectRows<InsertRow>(insertPlan);
```

### Queries with Joins

```typescript
import { sql, tables } from '../prisma/query';
import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = tables.user;
const postTable = tables.post;

const plan = sql
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
import { sql, tables } from '../prisma/query';
import type { ResultType } from '@prisma-next/sql-query/types';

const userTable = tables.user;
const postTable = tables.post;

const plan = sql
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
import { orm } from '@prisma-next/orm-lane/orm';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createExecutionStack, instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';

const contract = validateContract<Contract>(contractJson);
const stack = createExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensionPacks: [] });
const stackInstance = instantiateExecutionStack(stack);
const context = createExecutionContext({ contract, stackInstance });
const o = orm<Contract>({ context });

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

**❌ WRONG: Don't import schema and access tables through it**

```typescript
import { schema, sql } from '../prisma/query';

// Don't do this - use the exported tables instead
const plan = sql
  .from(schema.tables.user)  // Too verbose
  .select({ id: schema.tables.user.columns.id })
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

1. **Always export `tables`** from `query.ts` as a convenience export
2. **Import `tables` directly** from `query.ts` instead of accessing through `schema`
3. **Extract variables** when tables/columns are reused multiple times
4. **Use `ResultType<typeof plan>`** to extract row types from plans
5. **Use direct access** for single-use queries to keep code concise
6. **Use ORM lane** for model-centric queries with relation traversal and base-model writes
7. **ORM entrypoint** uses model registry proxy (`orm.<model>()`) for discoverability
8. **Relation filters** use `where.related.<relation>.some/none/every(predicate)` pattern
9. **Includes** use `include.<relation>(child => ...)` pattern with capability gating
10. **Writes** use `create(data)`, `update(where, data)`, `delete(where)` with model-to-column mapping
