# PSL → IR Prototype

A TypeScript-based prototype system demonstrating a **PSL → IR toolchain** and **type-safe query builder** for relational databases.

## Overview

This project implements a complete pipeline from Prisma Schema Language (PSL) parsing to type-safe SQL query execution:

1. **PSL Parser** - Parses `.psl` files into an Abstract Syntax Tree (AST)
2. **IR Emitter** - Transforms AST into a validated Intermediate Representation (IR) and generates TypeScript types
3. **Query Builder** - Provides a fluent API for building type-safe SQL queries using Column objects
4. **Runtime** - Executes queries against PostgreSQL with schema verification

## Architecture

```
PSL File → Parser → AST → IR Emitter → schema.json + schema.d.ts
                                              ↓
Query Builder ← Generated Types ← schema.d.ts
     ↓
SQL Compiler → PostgreSQL Runtime
```

## Packages

- **`@prisma/relational-ir`** - Shared IR types and Zod validators
- **`@prisma/psl`** - PSL lexer, recursive descent parser, and CLI
- **`@prisma/schema-emitter`** - AST → IR transformation and TypeScript code generation
- **`@prisma/sql`** - Type-safe query builder and PostgreSQL SQL compiler
- **`@prisma/runtime`** - Database connection, query execution, and schema verification

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm 9.x
- PostgreSQL (for running the example)

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Running the Example

1. **Start PostgreSQL** (using Docker):
   ```bash
   docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
   ```

2. **Create the database table**:
   ```sql
   CREATE TABLE "user" (
     id SERIAL PRIMARY KEY,
     email VARCHAR(255) UNIQUE NOT NULL,
     active BOOLEAN DEFAULT true,
     "createdAt" TIMESTAMP DEFAULT NOW()
   );
   ```

3. **Generate schema files**:
   ```bash
   cd examples/todo-app
   pnpm generate
   ```

4. **Run the example**:
   ```bash
   pnpm start
   ```

## Usage Example

### 1. Define Schema (schema.psl)

```prisma
model User {
  id        Int        @id @default(autoincrement())
  email     String     @unique
  active    Boolean    @default(true)
  createdAt DateTime   @default(now())
}
```

### 2. Generate IR and Types

```bash
# Using CLI
psl emit schema.psl

# Or programmatically
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

const ast = parse(pslContent);
const { schema, types } = emitSchemaAndTypes(ast);
```

### 3. Build Type-Safe Queries

```typescript
import { sql, t } from '@prisma/sql';
import { connect } from '@prisma/runtime';
import ir from './schema.json' assert { type: 'json' };

const db = connect({ ir, verify: 'onFirstUse' });

// Type-safe query with Column objects
const query = sql()
  .from('user')
  .where(t.user.active.eq(true))
  .select({ id: t.user.id, email: t.user.email });

// Return type is inferred as Array<{ id: number; email: string }>
const results = await db.execute(query.build());
```

## Type Safety Features

### Column-Based API

The query builder uses Column objects that provide:

- **Type-safe field access**: `t.user.id` has type `Column<number>`
- **Type-safe expressions**: `t.user.active.eq(true)` returns `Expression<boolean>`
- **Automatic type inference**: Select results are typed based on Column types

### Generated Types

The schema emitter generates:

```typescript
// Generated schema.d.ts
export interface User {
  id: number;
  email: string;
  active?: boolean;
  createdAt?: Date;
}

export interface UserShape {
  id: number;
  email: string;
  active?: boolean;
  createdAt?: Date;
}

export const t: Tables = {
  user: {
    id: { table: 'user', name: 'id', eq: (value: number) => ... },
    email: { table: 'user', name: 'email', eq: (value: string) => ... },
    // ... other fields
  }
};
```

### Query Examples

```typescript
// Simple select with type inference
const activeUsers = sql()
  .from('user')
  .where(t.user.active.eq(true))
  .select({ id: t.user.id, email: t.user.email });
// Returns: Array<{ id: number; email: string }>

// Complex query with multiple conditions
const users = sql()
  .from('user')
  .where(t.user.id.gt(5))
  .select({ id: t.user.id, email: t.user.email, active: t.user.active })
  .orderBy('createdAt', 'DESC')
  .limit(10);
// Returns: Array<{ id: number; email: string; active: boolean }>

// IN expressions
const specificUsers = sql()
  .from('user')
  .where(t.user.id.in([1, 2, 3]))
  .select({ id: t.user.id, email: t.user.email });
```

## Testing

### Unit Tests

Each package includes comprehensive unit tests:

```bash
# Test specific package
cd packages/sql
pnpm test

# Test all packages
pnpm test
```

### Integration Tests

The example app includes full integration tests using `@prisma/dev`:

```bash
cd examples/todo-app
pnpm test:integration
```

Integration tests:
- Spin up PostgreSQL using `@prisma/dev`
- Create tables and insert test data
- Execute type-safe queries
- Verify return types and values
- Test error handling for unknown tables/columns

## Development

### Project Structure

```
prisma-next-proto/
├── packages/
│   ├── relational-ir/     # IR types and validators
│   ├── psl/               # PSL parser and CLI
│   ├── schema-emitter/    # AST → IR + TypeScript generation
│   ├── sql/               # Query builder and SQL compiler
│   └── runtime/           # Database runtime
├── examples/
│   └── todo-app/          # Example application with integration tests
└── .github/workflows/     # CI configuration
```

### Available Scripts

- `pnpm build` - Build all packages
- `pnpm dev` - Start development mode (watch)
- `pnpm test` - Run all tests
- `pnpm lint` - Lint all packages
- `pnpm typecheck` - Type check all packages
- `pnpm clean` - Clean all build artifacts

### Adding New Features

1. **New PSL syntax**: Extend the lexer and parser in `@prisma/psl`
2. **New field types**: Add to `FieldTypeSchema` in `@prisma/relational-ir`
3. **New query operations**: Extend the query builder in `@prisma/sql`
4. **New database support**: Implement new runtime in `@prisma/runtime`

## API Reference

### Query Builder

```typescript
// Create a query builder
const query = sql().from('tableName');

// Add conditions
query.where(t.table.column.eq(value));

// Select specific fields
query.select({ alias: t.table.column });

// Add ordering and limits
query.orderBy('column', 'ASC').limit(10);

// Build the query
const { sql, params, rowType } = query.build();
```

### Column Expressions

```typescript
// Equality
t.user.id.eq(1)

// Comparison
t.user.id.gt(5)
t.user.id.lt(10)
t.user.id.gte(1)
t.user.id.lte(100)
t.user.email.ne('test@example.com')

// Membership
t.user.id.in([1, 2, 3])
```

### Runtime Connection

```typescript
import { connect } from '@prisma/runtime';

const db = connect({
  ir: schemaIR,
  verify: 'onFirstUse', // or 'never'
  database: {
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  },
});

// Execute queries
const results = await db.execute(query.build());

// Clean up
await db.end();
```

## Contributing

This is a prototype project for demonstrating PSL → IR toolchain concepts. The codebase prioritizes clarity and educational value over production readiness.

## License

MIT

