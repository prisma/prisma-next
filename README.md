# PSL → IR Prototype

A TypeScript-based prototype system demonstrating a **PSL → IR toolchain** and **type-safe query builder** for relational databases.

## Overview

This project implements a complete pipeline from Prisma Schema Language (PSL) parsing to type-safe SQL query execution:

1. **PSL Parser** - Parses `.psl` files into an Abstract Syntax Tree (AST)
2. **IR Emitter** - Transforms AST into a validated Intermediate Representation (IR) and generates TypeScript types
3. **Query Builder** - Provides a fluent API for building type-safe SQL queries
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

3. **Run the example**:
   ```bash
   cd examples/todo-app
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

```typescript
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

const ast = parse(pslContent);
const { schema, types } = emitSchemaAndTypes(ast);

// Write schema.json and schema.d.ts
```

### 3. Build Type-Safe Queries

```typescript
import { sql, t } from '@prisma/sql';
import { connect } from '@prisma/runtime';
import ir from './schema.json' assert { type: 'json' };

const db = connect({ ir, verify: 'onFirstUse' });

const query = sql()
  .from('user')
  .where(t.user.active.eq(true))
  .select({ id: 'id', email: 'email' });

const results = await db.execute(query);
```

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
│   └── todo-app/          # Example application
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

## Testing

Each package includes unit tests using Vitest:

```bash
# Test specific package
cd packages/psl
pnpm test

# Test all packages
pnpm test
```

## Contributing

This is a prototype project for demonstrating PSL → IR toolchain concepts. The codebase prioritizes clarity and educational value over production readiness.

## License

MIT

