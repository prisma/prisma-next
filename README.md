# Prisma Next Prototype

A TypeScript-based prototype demonstrating a **contract-first data layer** architecture that decomposes Prisma's ORM into modular, verifiable components.

## Primary Motivation

Prisma's current ORM architecture tightly couples three layers — the Prisma Schema Language (PSL), the generated client, and runtime execution. This coupling introduces rigidity, rebuild cost, and conceptual opacity.

The prototype aims to rethink Prisma's data layer around a **contract-first model**, where the schema is a stable, versioned artifact describing the database structure — not fuel for codegen, but a data contract.

## Core Goals

### 1. PSL as Data Contract
- Treat PSL output as a versioned, deterministic intermediate representation (IR) rather than as code-generation input
- Include a `contractHash` inside the IR to cryptographically tie all downstream artifacts (queries, clients, etc.) to a specific schema version
- The IR becomes the single source of truth for:
  - Query validation
  - Policy enforcement
  - Linting/guardrails
  - Compatibility and migration safety

### 2. Composable, Dialect-Agnostic Query Layer
- Replace the monolithic generated Prisma Client with a runtime-compiled query DSL (`@prisma/sql`)
- Queries are written inline in TypeScript and compiled at runtime into SQL ASTs, then lowered to the specific dialect (Postgres initially)
- This layer can be reused or extended for future targets (MySQL, SQLite, Mongo, etc.) without requiring full client regeneration

### 3. Separation of Concerns
- `@prisma/relational-ir`: defines the schema contract, validation, and serialization
- `@prisma/sql`: builds and compiles query ASTs to dialect SQL
- `@prisma/runtime`: executes query Plans, enforces contracts, and hosts plugin hooks (guardrails, budgets, telemetry, etc.)
- Each package can evolve independently and compose cleanly

### 4. No Extra Compile Step for Queries
- Only the PSL → IR → Types emission happens as build-time codegen
- Query compilation happens at runtime, allowing interactive and incremental development without regenerating a client binary

### 5. Verifiable, Auditable Plans
- Every query Plan includes metadata: referenced tables, columns, dialect, and `contractHash`
- This enables contract verification, policy injection, and linting guardrails at runtime or in CI

### 6. Extensible Runtime Plugin Framework
- Instead of wrapping the DB client, a first-class hook system lets plugins intercept Plan lifecycle events:
  - `beforeCompile`, `afterCompile`
  - `beforeExecute`, `afterExecute`
  - `onError`
- Enables composable linting (e.g. "no SELECT *"), telemetry, query budgets, and policy enforcement without entangling the core runtime

### 7. Type-Safe Query Shapes
- Query result types are derived from the schema IR and the explicit `select()` projection
- Left joins and other nullable relations correctly reflect nullability in result types
- The type system ensures queries are both safe (no missing columns) and accurate (correct result shapes)

## Architecture

```
PSL File → Parser → AST → IR Emitter → contract.json + schema.d.ts
                                              ↓
Query Builder ← Generated Types ← schema.d.ts
     ↓
SQL Compiler → Runtime (with Plugin Hooks) → PostgreSQL
```

The architecture decomposes Prisma's ORM into modular, contract-verified components:
- **PSL defines a verifiable schema contract** → **IR encodes it deterministically** → **the runtime consumes it to safely compile, execute, and audit queries without codegen friction**

## Demonstration Goals

The prototype demonstrates, not perfects, the following ideas:

| Goal | Demonstrated By |
|------|----------------|
| PSL → IR pipeline with hash | `@prisma/relational-ir` generator |
| Runtime-safe query DSL | `@prisma/sql` package |
| Dialect lowering | Postgres compiler implementation |
| Plan metadata & verification | `contractHash`, refs in Plan |
| Guardrails as runtime plugins | `@prisma/runtime` plugin hooks |
| Optional ORM layer built on DSL | `@prisma/orm` prototype (relations, includes) |

## Packages

- **`@prisma/relational-ir`** - Schema contract definition, validation, and serialization
- **`@prisma/psl`** - PSL lexer, recursive descent parser, and CLI
- **`@prisma/schema-emitter`** - AST → IR transformation and TypeScript code generation
- **`@prisma/sql`** - Type-safe query builder and PostgreSQL SQL compiler
- **`@prisma/runtime`** - Database connection, query execution, contract verification, and plugin hooks
- **`@prisma/orm`** - Optional ORM layer with relations and higher-level abstractions

## What's Left to Explore

- **Schema evolution**: how IR hashes change across versions and how to diff/verify in CI
- **ORM extensions**: building higher abstractions (relations, findOne/findMany) on top of the DSL safely
- **Multi-dialect support**: confirm the abstraction is portable beyond Postgres
- **Dynamic guardrails**: budgets, query cost estimation, EXPLAIN-based profiling
- **Recording & golden testing**: capture query shapes and SQL output for regression testing

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

### 2. Generate Contract and Types

```bash
# Using CLI
psl emit schema.psl

# Or programmatically
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

const ast = parse(pslContent);
const { contract, types } = emitSchemaAndTypes(ast);
```

### 3. Build Type-Safe Queries

```typescript
import { sql, t } from '@prisma/sql';
import { createRuntime } from '@prisma/runtime';
import contract from './contract.json' assert { type: 'json' };

// Create runtime with contract verification
const runtime = createRuntime({
  ir: contract,
  driver: postgresDriver,
  verify: 'onFirstUse'
});

// Type-safe query with Column objects
const query = sql()
  .from('user')
  .where(t.user.active.eq(true))
  .select({ id: t.user.id, email: t.user.email });

// Return type is inferred as Array<{ id: number; email: string }>
const results = await runtime.execute(query);
```

### 4. Runtime Plugin System

```typescript
import { lint } from '@prisma/runtime/plugins';

// Add guardrails as composable plugins
const runtime = createRuntime({
  ir: contract,
  driver: postgresDriver,
  plugins: [
    lint({
      rules: {
        'no-select-star': 'error',
        'mutation-requires-where': 'error',
        'no-missing-limit': 'warn'
      }
    })
  ]
});
```

## Type Safety Features

### Column-Based API

The query builder uses Column objects that provide:

- **Type-safe field access**: `t.user.id` has type `Column<number>`
- **Type-safe expressions**: `t.user.active.eq(true)` returns `Expression<boolean>`
- **Automatic type inference**: Select results are typed based on Column types

### Generated Contract and Types

The schema emitter generates:

```typescript
// Generated schema.d.ts
export interface User {
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

```json
// Generated contract.json
{
  "version": 3,
  "target": "postgres",
  "contractHash": "sha256:abc123...",
  "tables": {
    "user": {
      "columns": {
        "id": { "type": "int4", "pk": true },
        "email": { "type": "text", "unique": true },
        "active": { "type": "bool", "default": true },
        "createdAt": { "type": "timestamp", "default": "now()" }
      }
    }
  }
}
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
import { createRuntime } from '@prisma/runtime';
import { createPostgresDriver } from '@prisma/runtime/drivers';

const runtime = createRuntime({
  ir: contractIR,
  driver: createPostgresDriver({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  }),
  verify: 'onFirstUse', // or 'never'
  plugins: [
    // Optional: add linting, telemetry, budgets, etc.
  ]
});

// Execute queries
const results = await runtime.execute(query);

// Clean up
await runtime.end();
```

