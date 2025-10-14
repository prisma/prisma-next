# @prisma/sql

Type-safe SQL query builder DSL with contract hash verification and SQL compilation.

## Goals

- Provide a fluent, type-safe SQL query builder
- Enable contract hash verification for query safety
- Compile query AST to optimized SQL
- Support relational operations (joins, filters, projections)
- Replace traditional ORM abstractions with transparent SQL

## Architecture

The package consists of several key components:

- **Query Builder**: Fluent API for building SQL queries
- **Type System**: Type-safe column and table handles
- **SQL Compiler**: Converts query AST to SQL with parameters
- **Contract Verification**: Ensures all query elements share the same contract hash
- **Expression System**: Type-safe SQL expressions and operators

## Installation

```bash
# In a workspace environment
pnpm add @prisma/sql
```

## Exports

### Main Export

- `sql` - SQL builder entry point
- `makeT<TTables>(ir)` - Creates typed table/column handles
- `QueryBuilder` - Fluent query builder class
- `compileToSQL()` - Compiles query AST to SQL
- Raw SQL utilities and expression types

### Sub-exports

- `@prisma/sql/builder` - Builder classes and utilities
- `@prisma/sql/compiler` - SQL compiler implementation
- `@prisma/sql/types` - Type definitions for queries and expressions
- `@prisma/sql/maket` - makeT factory function

## Usage Examples

### Basic Query Building

```typescript
import { sql, makeT } from '@prisma/sql';
import contractIR from './contract.json';

const t = makeT(contractIR);

// Simple select query
const usersQuery = sql
  .from(t.user)
  .where(t.user.active.eq(true))
  .select({ id: t.user.id, email: t.user.email })
  .limit(10);

const plan = usersQuery.build();
console.log(plan.sql); // "SELECT user.id, user.email FROM user WHERE user.active = $1 LIMIT $2"
console.log(plan.params); // [true, 10]
```

### Contract Hash Verification

```typescript
import { sql, makeT } from '@prisma/sql';

const t1 = makeT(contractIR1);
const t2 = makeT(contractIR2);

// This will throw an error due to contract hash mismatch
try {
  const query = sql
    .from(t1.user)
    .select({ id: t2.user.id }); // Different contract!
} catch (error) {
  console.error(error.message); // "E_CONTRACT_MISMATCH: contract hash mismatch..."
}
```

### Complex Queries with Joins

```typescript
import { sql, makeT } from '@prisma/sql';

const t = makeT(contractIR);

// Join query
const postsWithAuthors = sql
  .from(t.post)
  .join(t.user, t.user.id.eq(t.post.authorId))
  .where(t.post.published.eq(true))
  .select({
    postId: t.post.id,
    title: t.post.title,
    authorName: t.user.name,
    authorEmail: t.user.email
  })
  .orderBy('createdAt', 'DESC')
  .limit(20);

const plan = postsWithAuthors.build();
```

### Raw SQL and Expressions

```typescript
import { sql, makeT, raw } from '@prisma/sql';

const t = makeT(contractIR);

// Using raw SQL expressions
const complexQuery = sql
  .from(t.user)
  .where(
    t.user.createdAt.gte(raw('NOW() - INTERVAL \'30 days\''))
    .and(t.user.email.like('%@company.com'))
  )
  .select({
    id: t.user.id,
    email: t.user.email,
    daysSinceCreated: raw('EXTRACT(DAYS FROM NOW() - created_at)')
  });
```

### Query Building with Type Safety

```typescript
import { sql, makeT, InferSelectResult } from '@prisma/sql';

const t = makeT(contractIR);

const userQuery = sql
  .from(t.user)
  .select({
    id: t.user.id,
    email: t.user.email,
    name: t.user.name
  });

// TypeScript infers the result type
type UserResult = InferSelectResult<typeof userQuery>;
// UserResult = { id: number; email: string; name: string | null }
```

### Advanced Query Operations

```typescript
import { sql, makeT } from '@prisma/sql';

const t = makeT(contractIR);

// Aggregation query
const statsQuery = sql
  .from(t.post)
  .where(t.post.published.eq(true))
  .select({
    totalPosts: t.post.id.count(),
    avgViews: t.post.views.avg(),
    maxViews: t.post.views.max()
  });

// Subquery
const topAuthorsQuery = sql
  .from(t.user)
  .where(
    t.user.id.in(
      sql
        .from(t.post)
        .select({ authorId: t.post.authorId })
        .where(t.post.views.gt(1000))
    )
  )
  .select({ id: t.user.id, name: t.user.name });
```

## Related Packages

- **Dependencies**:
  - `@prisma/relational-ir` - Schema context and contract verification
- **Used by**:
  - `@prisma/runtime` - Query execution
  - `@prisma/orm` - Relation loading and navigation
  - `@prisma/migrate` - Query generation for migrations

## Design Principles

- **Contract-First**: All queries verify against the data contract
- **Type Safety**: Full TypeScript support with inferred result types
- **Transparent SQL**: No hidden abstractions, SQL is visible and verifiable
- **Composable Primitives**: Each operation is a composable building block
- **AI-Friendly**: Clear DSL enables agent-based query generation
- **Verification Over Abstraction**: Contract hash verification replaces runtime magic
