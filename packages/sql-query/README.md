# @prisma-next/sql-query

SQL query builder and plan factories for Prisma Next.

## Overview

The SQL query package provides query authoring surfaces (DSL, Raw SQL) that compile to unified Plans. It includes SQL-specific contract types, validation, and a query builder DSL that produces Plans with SQL, parameters, and metadata.

This package implements the Query Lanes subsystem for SQL targets, providing multiple authoring ergonomics while keeping dialect/capability logic out of lanes. All lanes compile to the same Plan structure that the runtime executes with consistent verification and guardrails.

## Purpose

Provide SQL query authoring surfaces that compile to immutable Plans. Support multiple authoring ergonomics (DSL, Raw SQL) while maintaining one query → one statement semantics.

## Responsibilities

- **Query DSL**: Relational DSL that compiles to Plans with AST, SQL, and metadata
- **Raw SQL**: Raw SQL escape hatch with required annotations and verification
- **Contract Types**: SQL-specific contract types (`SqlContract`, `SqlStorage`, etc.)
- **Contract Validation**: Structural validation for SQL contracts using Arktype
- **Contract Builder**: TypeScript builder for creating SQL contracts programmatically
- **Plan Factories**: Compile declarative inputs into deterministic Plans

**Non-goals:**
- Execution or runtime behavior (runtime)
- Dialect-specific lowering (adapters)
- Policy enforcement (plugins)

## Architecture

```mermaid
flowchart TD
    subgraph "Query Lanes"
        DSL[SQL DSL]
        RAW[Raw SQL]
    end

    subgraph "Plan Factories"
        SQL[SQL Factory]
        RAW_FACT[Raw Factory]
    end

    subgraph "Contract"
        CT[Contract Types]
        VAL[Validation]
        BUILDER[Contract Builder]
    end

    subgraph "Output"
        PLAN[Plan]
    end

    DSL --> SQL
    RAW --> RAW_FACT
    SQL --> PLAN
    RAW_FACT --> PLAN
    CT --> SQL
    CT --> RAW_FACT
    VAL --> CT
    BUILDER --> CT
    PLAN --> RT[Runtime]
```

## Components

### Query Builder (`sql.ts`)
- Relational DSL for building SQL queries
- Compiles to Plans with AST, SQL, and metadata
- Supports projections, filters, joins, ordering, limits
- **Nested Projection Shaping**: Express nested object literals in `.select()` for compile-time type inference, while runtime produces flat SQL with flattened aliases (e.g., `post.title` → `post_title`)
- **Nested Array Includes (`includeMany`)**: Express 1:N relationships that return one row per parent with a nested array field for children, built in a single statement using `LATERAL` + `json_agg` when supported. Requires both `lateral` and `jsonAgg` capabilities to be `true` in the contract.
- Join methods: `innerJoin()`, `leftJoin()`, `rightJoin()`, `fullJoin()`
- Join ON conditions use `on.eqCol(left, right)` callback pattern
- Self-joins are not supported in MVP

### Raw SQL (`raw.ts`)
- Raw SQL escape hatch with template tags and function form
- Required annotations for verification and guardrails
- Produces Plans with SQL, parameters, and metadata

### Schema Builder (`schema.ts`)
- Type-safe table and column builders
- Infers JavaScript types from contract types
- Supports column builders with metadata

### Parameter Builder (`param.ts`)
- Parameter placeholder factory
- Type-safe parameter handling

### Contract Types (`contract-types.ts`)
- SQL-specific contract types (re-exported from `@prisma-next/sql-target`)
- `SqlContract`, `SqlStorage`, `StorageColumn`, etc.

### Contract Validation (`contract.ts`)
- Structural validation for SQL contracts using Arktype
- Type guards and validation schemas
- `validateContract<TContract>()` requires a fully-typed contract type `TContract` (from `contract.d.ts`), NOT a generic `SqlContract<SqlStorage>`. Using a generic type will cause all subsequent type inference to fail. See function documentation for details.

### Contract Builder (`contract-builder.ts`)
- TypeScript builder for creating SQL contracts programmatically
- Fluent API for defining tables, columns, constraints

### Types (`types.ts`)
- Plan types, AST types, and utility types
- Type inference helpers for columns and projections

### Errors (`errors.ts`)
- SQL-specific error types and factories

## Dependencies

- **`@prisma-next/contract`**: Core contract types
- **`@prisma-next/sql-target`**: SQL contract types, adapter interfaces
- **`arktype`**: Runtime type validation

## Related Subsystems

- **[Query Lanes](../../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)**: Detailed subsystem specification
- **[Runtime & Plugin Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)**: Plan execution

## Related ADRs

- [ADR 002 - Plans are Immutable](../../docs/architecture%20docs/adrs/ADR%20002%20-%20Plans%20are%20Immutable.md)
- [ADR 003 - One Query One Statement](../../docs/architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)
- [ADR 011 - Unified Plan Model](../../docs/architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 012 - Raw SQL Escape Hatch](../../docs/architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md)
- [ADR 020 - Result Typing Rules](../../docs/architecture%20docs/adrs/ADR%20020%20-%20Result%20Typing%20Rules.md)

## Usage

### SQL DSL

```typescript
import { sql, schema } from '@prisma-next/sql-query/sql';
import contract from './contract.json';

const t = schema(contract);

const plan = sql()
  .from(t.user)
  .where(t.user.active.eq(param('active')))
  .select({ id: t.user.id, email: t.user.email })
  .limit(100)
  .build();
```

### SQL DSL with Joins

```typescript
import { sql, schema } from '@prisma-next/sql-query/sql';
import contract from './contract.json';

const t = schema(contract);

const plan = sql()
  .from(t.user)
  .innerJoin(t.post, (on) => on.eqCol(t.user.id, t.post.userId))
  .where(t.user.active.eq(param('active')))
  .select({
    userId: t.user.id,
    email: t.user.email,
    postId: t.post.id,
    title: t.post.title,
  })
  .build({ params: { active: true } });
```

### SQL DSL with Nested Projections

```typescript
import { sql, schema } from '@prisma-next/sql-query/sql';
import contract from './contract.json';

const t = schema(contract);

// Nested projection shape for compile-time type inference
const plan = sql()
  .from(t.user)
  .innerJoin(t.post, (on) => on.eqCol(t.user.id, t.post.userId))
  .select({
    name: t.user.name,
    post: {
      title: t.post.title,
      content: t.post.content,
    },
  })
  .build();

// ResultType<typeof plan> infers: { name: string, post: { title: string, content: string } }
// Runtime returns flat rows with flattened aliases: { name: string, post_title: string, post_content: string }
```

### SQL DSL with includeMany

```typescript
import { sql, schema } from '@prisma-next/sql-query/sql';
import contract from './contract.json';

const t = schema(contract);

// includeMany returns one row per parent with nested array of children
const plan = sql()
  .from(t.user)
  .includeMany(
    t.post,
    (on) => on.eqCol(t.user.id, t.post.userId),
    (child) => child
      .select({ id: t.post.id, title: t.post.title })
      .where(t.post.published.eq(true))
      .orderBy(t.post.createdAt.desc())
      .limit(10),
    { alias: 'posts' }
  )
  .select({
    id: t.user.id,
    name: t.user.name,
    posts: true,  // Boolean true references the include alias
  })
  .build();

// ResultType<typeof plan> infers: { id: number; name: string; posts: Array<{ id: number; title: string }> }
// Runtime returns: { id: 1, name: "Alice", posts: [{ id: 1, title: "Post 1" }, ...] }
```

**Note**: `includeMany` is capability-gated and requires both `lateral: true` and `jsonAgg: true` in the contract's capabilities. It's a separate feature from nested projection shaping (which flattens nested objects into flat rows).

### Contract Validation

```typescript
import { validateContract } from '@prisma-next/sql-query/schema';
import type { Contract } from './contract.d';
import contractJson from './contract.json' assert { type: 'json' };

// ✅ CORRECT: Use fully-typed contract type from contract.d.ts
const contract = validateContract<Contract>(contractJson);

// ❌ WRONG: Don't use generic SqlContract<SqlStorage>
// const contract = validateContract<SqlContract<SqlStorage>>(contractJson);
// This will cause all types to be inferred as 'unknown'
```

### Raw SQL

```typescript
import { sql } from '@prisma-next/sql-query/sql';
import { param } from '@prisma-next/sql-query/param';

const plan = sql`
  SELECT id, email FROM user WHERE active = ${param(true)} LIMIT 100
`;
```

## Exports

- `./sql`: SQL DSL and raw SQL factories
- `./schema`: Schema builder and contract validation
- `./param`: Parameter builder
- `./types`: Plan types and utility types
- `./errors`: SQL-specific error types
- `./contract-types`: SQL contract types (re-exported)
- `./contract-builder`: Contract builder API
- `./schema-sql`: SQL contract JSON Schema

