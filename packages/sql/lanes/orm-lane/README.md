# @prisma-next/sql-orm-lane

ORM builder, include compilation, and relation filters for Prisma Next.

## Overview

This package provides the ORM query builder that compiles model-based queries to SQL lane primitives. It is part of the SQL lanes ring and depends on `@prisma-next/sql-relational-core` for schema access.

## Responsibilities

- **ORM query builder**: Model-based query builder (`orm()`)
- **Include compilation**: ORM includes compile to SQL lane primitives like `includeMany`
- **Relation filters**: Filter queries by related model properties (`some`, `none`, `every`)
- **Cursor pagination**: Cursor-based pagination with automatic ORDER BY generation
- **Model accessors**: Type-safe access to models and their columns/relations

## Dependencies

- `@prisma-next/contract` - Contract types and plan metadata
- `@prisma-next/plan` - Plan helpers and error utilities
- `@prisma-next/runtime` - Runtime context for adapter access
- `@prisma-next/sql-relational-core` - Schema and column builders
- `@prisma-next/sql-target` - SQL contract types and AST definitions

## Exports

- `.` - Main package export (exports `orm` and related types)
- `./orm` - ORM builder entry point (`orm()`, `OrmRegistry`, `OrmModelBuilder`, etc.)

## Architecture

This package compiles ORM queries to SQL lane primitives (AST nodes). Dialect-specific lowering to SQL strings happens in adapters (per ADR 015 and ADR 016).

The ORM builder:
1. Takes model-based queries (e.g., `orm().user().where(...).include(...)`)
2. Compiles them to SQL lane primitives (e.g., `sql().from(...).where(...).includeMany(...)`)
3. Returns plans that can be executed by the runtime

### Package Structure

The package is organized into modular components following a domain-driven structure:

```
src/
├── orm/              # Core ORM builder and state management
│   ├── builder.ts    # Main OrmModelBuilderImpl facade
│   ├── context.ts    # OrmContext and factory
│   ├── state.ts      # Immutable state shapes
│   └── capabilities.ts # Runtime capability checks
├── selection/        # Query selection building
│   ├── predicates.ts # WHERE clause building
│   ├── ordering.ts   # ORDER BY clause building
│   ├── cursor.ts     # Cursor pagination utilities
│   ├── pagination.ts # LIMIT/OFFSET handling
│   ├── projection.ts # SELECT projection flattening
│   ├── join.ts       # JOIN ON expression building
│   └── select-builder.ts # Main SELECT AST assembly
├── relations/        # Relation handling
│   └── include-plan.ts # Include AST and EXISTS subquery building
├── mutations/        # Write operations
│   ├── insert-builder.ts # INSERT plan building
│   ├── update-builder.ts # UPDATE plan building
│   └── delete-builder.ts # DELETE plan building
├── plan/             # Plan assembly and metadata
│   ├── plan-assembly.ts # PlanMeta building and Plan creation
│   ├── lowering.ts   # Lane-specific pre-lowering (placeholder)
│   └── result-typing.ts # Type-level helpers (placeholder)
├── utils/            # Shared utilities
│   ├── ast.ts        # AST factory wrappers
│   ├── errors.ts     # Centralized error constructors
│   └── guards.ts     # Type guards and helpers
└── types/            # Internal type exports
    └── internal.ts   # Re-exported internal types
```

**Design Principles:**
- **Modular**: Each module has a single, well-defined responsibility
- **Pure helpers**: Utility functions are side-effect free
- **Centralized errors**: All error messages come from `utils/errors.ts`
- **Type-safe**: Proper generic types throughout, avoiding `any`
- **Immutable state**: Builder state is immutable, methods return new instances

## Cursor Pagination

Cursor-based pagination provides efficient pagination for large datasets by using a cursor value (typically a primary key or timestamp) to retrieve the next set of results.

### Usage

```typescript
import { orm } from '@prisma-next/sql-orm-lane/orm';
import { param } from '@prisma-next/sql-relational-core/param';

const o = orm<Contract>({ context });

// Forward pagination (gt/gte) - returns items after cursor, ordered ASC
const plan = o.user()
  .cursor((u) => lastId !== undefined ? u.id.gt(param('lastId')) : undefined)
  .take(10)
  .findMany({ params: { lastId: 42 } });

// Backward pagination (lt/lte) - returns items before cursor, ordered DESC
const plan = o.user()
  .cursor((u) => lastId !== undefined ? u.id.lt(param('lastId')) : undefined)
  .take(10)
  .findMany({ params: { lastId: 42 } });
```

### Key Features

- **Tight API**: `CursorBuilder` only exposes `gt`, `lt`, `gte`, `lte` operations (no `eq`, no chaining with `and/or`)
- **Automatic ORDER BY**: Cursor automatically generates ORDER BY clauses:
  - `gt` or `gte` → `column ASC`
  - `lt` or `lte` → `column DESC`
- **WHERE combination**: Cursor predicate is combined with existing WHERE clauses using `AND`
- **ORDER BY override**: Cursor ORDER BY takes precedence over explicit `orderBy()` calls
- **Optional cursor**: Returning `undefined` from the cursor function skips cursor pagination

### CursorBuilder API

The `CursorBuilder` type provides a restricted API for cursor operations:

```typescript
interface CursorBuilder {
  gt(value: ParamPlaceholder): CursorPredicate;   // Greater than
  lt(value: ParamPlaceholder): CursorPredicate;   // Less than
  gte(value: ParamPlaceholder): CursorPredicate;  // Greater than or equal
  lte(value: ParamPlaceholder): CursorPredicate;  // Less than or equal
  // NO eq, and, or methods - cannot be chained
}
```

### Accessing Cursor Builder

The `cursor()` method provides a `CursorModelAccessor` where columns are `CursorBuilder` instances directly:

```typescript
const plan = o.user()
  .cursor((u) => {
    // u.id is a CursorBuilder (not ColumnBuilder)
    // Direct access to gt/lt/gte/lte methods
    return u.id.gt(param('lastId'));
  })
  .findMany({ params: { lastId: 42 } });
```

### Combining with Other Query Methods

Cursor can be combined with other query methods:

```typescript
// Cursor with WHERE clause
const plan = o.user()
  .where((u) => u.email.eq(param('email')))
  .cursor((u) => u.id.gt(param('lastId')))
  .take(10)
  .findMany({ params: { email: 'test@example.com', lastId: 42 } });

// Cursor overrides explicit orderBy
const plan = o.user()
  .orderBy((u) => u.createdAt.desc())  // This will be overridden
  .cursor((u) => u.id.gt(param('lastId')))  // ORDER BY id ASC
  .findMany({ params: { lastId: 42 } });
```

### Limitations

- **Single-field cursors only**: Multi-field cursors (composite cursors) are not yet supported
- **No chaining**: Cursor predicates cannot be chained with `and/or` operations
- **No equality**: Cursor does not support `eq` operations (use `where()` instead)

## Related Packages

- `@prisma-next/sql-relational-core` - Provides schema and column builders used by this package
- `@prisma-next/sql-target` - Defines SQL contract types and AST structures
