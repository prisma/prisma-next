# @prisma/orm

Optional ORM-style relation loading and navigation built on top of `@prisma/sql`.

## Goals

- Provide ORM-like ergonomics for relation loading
- Enable type-safe `.include()` operations
- Support nested relation navigation
- Compile ORM queries to efficient SQL queries
- Maintain transparency - no hidden lazy loading or magic

## Architecture

The package consists of several key components:

- **ORM Factory**: Creates type-safe ORM builders from contract IR
- **Relation Builders**: Fluent API for building include queries
- **Query Lowering**: Converts ORM queries to SQL queries
- **Type System**: Type-safe relation handles and result types
- **Lowerer Registry**: Extensible system for different relation patterns

## Installation

```bash
# In a workspace environment
pnpm add @prisma/orm
```

## Exports

### Main Export

- `orm(ir)` - ORM factory function
- Type-safe builders with `.include()` support
- `lowerRelations()` - Converts ORM queries to SQL queries
- Relation handles and typed builders
- Lowerer registry for extensibility

## Usage Examples

### Basic ORM Usage

```typescript
import { orm } from '@prisma/orm';
import contractIR from './contract.json';

const db = orm(contractIR);

// Simple query
const users = await db.user.findMany({
  where: { active: true },
  select: { id: true, email: true }
});
```

### Relation Loading with Include

```typescript
import { orm } from '@prisma/orm';

const db = orm(contractIR);

// Load users with their posts
const usersWithPosts = await db.user.findMany({
  include: {
    posts: {
      where: { published: true },
      select: { id: true, title: true, createdAt: true }
    }
  }
});

// TypeScript infers the result type
type UserWithPosts = typeof usersWithPosts[0];
// UserWithPosts = {
//   id: number;
//   email: string;
//   name: string | null;
//   posts: Array<{
//     id: number;
//     title: string;
//     createdAt: Date;
//   }>;
// }
```

### Nested Relations

```typescript
import { orm } from '@prisma/orm';

const db = orm(contractIR);

// Deep nested includes
const postsWithAuthorsAndComments = await db.post.findMany({
  include: {
    author: {
      select: { id: true, name: true, email: true }
    },
    comments: {
      include: {
        author: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    }
  },
  where: { published: true }
});
```

### Type-Safe Relation Navigation

```typescript
import { orm, TypedOrmBuilder } from '@prisma/orm';

const db = orm(contractIR);

// Type-safe relation handles
const userHandle = db.user;
const postHandle = db.post;

// Relations are type-safe
const userPostsRelation = userHandle.posts; // TypedOrmBuilder<Post>
const postAuthorRelation = postHandle.author; // TypedOrmBuilder<User>

// Use relations in queries
const userWithRecentPosts = await userHandle.findFirst({
  where: { email: 'user@example.com' },
  include: {
    posts: {
      where: { createdAt: { gte: new Date('2024-01-01') } },
      orderBy: { createdAt: 'desc' },
      take: 10
    }
  }
});
```

### Query Lowering

```typescript
import { orm, lowerRelations } from '@prisma/orm';
import { sql } from '@prisma/sql';

const db = orm(contractIR);

// Build ORM query
const ormQuery = db.user.findMany({
  include: {
    posts: {
      where: { published: true },
      select: { id: true, title: true }
    }
  },
  where: { active: true }
});

// Lower to SQL query
const sqlQuery = lowerRelations(ormQuery);

// Execute with SQL runtime
const results = await sqlRuntime.execute(sqlQuery);
```

### Custom Lowerers

```typescript
import { orm, lowererRegistry, RelationsLowerer } from '@prisma/orm';

// Register custom lowerer for specific relation patterns
const customLowerer: RelationsLowerer = {
  name: 'custom-pattern',
  canLower: (query) => {
    // Check if this lowerer can handle the query
    return query.includes.some(inc => inc.relation === 'customRelation');
  },
  lower: (query, context) => {
    // Convert ORM query to SQL query
    return sql.from('user').select({ /* custom SQL */ });
  }
};

lowererRegistry.register(customLowerer);

const db = orm(contractIR);
// Custom lowerer will be used for queries matching the pattern
```

### Advanced Query Patterns

```typescript
import { orm } from '@prisma/orm';

const db = orm(contractIR);

// Conditional includes
const usersWithOptionalPosts = await db.user.findMany({
  include: {
    posts: {
      where: { published: true },
      take: 5,
      orderBy: { createdAt: 'desc' }
    }
  },
  where: {
    OR: [
      { email: { contains: '@company.com' } },
      { posts: { some: { views: { gt: 1000 } } } }
    ]
  }
});

// Aggregation with relations
const userStats = await db.user.findMany({
  include: {
    posts: {
      select: {
        _count: { id: true },
        _avg: { views: true },
        _max: { views: true }
      }
    }
  }
});
```

## Related Packages

- **Dependencies**:
  - `@prisma/relational-ir` - Schema context and relation graph
  - `@prisma/sql` - Query building and compilation
- **Used by**:
  - Applications requiring ORM-style ergonomics
  - Higher-level abstractions built on top of SQL DSL

## Design Principles

- **Composable Primitives**: ORM features are built from composable SQL primitives
- **Type Safety**: Full TypeScript support with inferred relation types
- **Transparency**: No hidden lazy loading or magic - queries are explicit
- **Performance**: Efficient SQL generation with minimal N+1 queries
- **Extensibility**: Lowerer registry enables custom relation patterns
- **Contract-First**: All operations verify against the data contract
- **AI-Friendly**: Clear API enables agent-based query generation
