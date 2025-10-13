# Prisma Next Prototype

A TypeScript-based prototype demonstrating a **contract-first data layer** architecture that decomposes Prisma's ORM into modular, verifiable components.

## What Is This?

Prisma Next is a prototype of a new data access layer that replaces traditional ORMs with a "contract-first" approach. It follows a similar workflow to Prisma ORM but with key differences:

- **Defines your database schema as a verifiable contract** (not just a schema)
- **Generates lightweight types instead of heavy client code**
- **Uses a composable DSL for queries instead of generated methods**
- **Works seamlessly with AI coding assistants** (machine-readable, composable APIs)

**Think of it as**: "What if Prisma ORM generated only lightweight types instead of heavy client code, and you wrote queries using a composable DSL instead of generated methods?"

## Evaluation Guide

**New to this project?** Check out our comprehensive [Evaluation Guide](EVALUATION-GUIDE.md) for:
- Quick 5-minute demo
- Structured evaluation process
- Comparison with existing solutions
- Success criteria and troubleshooting

## Motivation

Prisma's current ORM architecture tightly couples three layers — the Prisma Schema Language (PSL), the generated client, and runtime execution. This coupling introduces rigidity, rebuild cost, and conceptual opacity.

The prototype rethinks Prisma's data layer around a **contract-first model**, where the schema is a stable, versioned artifact describing the database structure — not fuel for codegen, but a data contract.

## Agent-Accessible Design

Modern developer agents (Cursor, Windsurf, v0.dev) increasingly read, reason about, and modify codebases. For a data access layer to be truly idiomatic in this environment, it must be:

- **Machine-navigable**: Understandable through static analysis without executing code
- **Composable**: Usable as an API surface agents can call directly or generate code against
- **Predictable**: Deterministic output with no hidden side effects or black-box codegen

The existing Prisma ORM is opaque to agents because schema → client codegen hides SQL semantics and many behaviors are runtime-generated.

This prototype addresses these shortcomings:

1. **PSL as explicit contract**: The IR is a deterministic JSON artifact — machine-readable, diffable, and stable
2. **Stable query DSL**: Queries are typed, composable ASTs that agents can statically analyze or synthesize
3. **Runtime integration surface**: Structured hooks around compile/execute events for verification, profiling, and policy enforcement
4. **Structured plans**: Every query results in a Plan object with AST, referenced columns, and contract hash

Agents can read the schema (IR), generate valid queries (DSL), and verify them (runtime) — all through open, structured artifacts with no black-box client to reverse engineer.

## Core Goals

### 1. Contract-First Architecture
- PSL defines a verifiable data contract, not just a schema
- IR includes `contractHash` to cryptographically tie all artifacts to a specific schema version
- Single source of truth for query validation, policy enforcement, and compatibility

### 2. Composable Query Layer
- Replace monolithic generated client with runtime-compiled query DSL (`@prisma/sql`)
- Queries written inline in TypeScript, compiled to SQL ASTs at runtime
- Dialect-agnostic design supports multiple targets (Postgres, MySQL, SQLite) without regeneration

### 3. Modular Package Architecture
- `@prisma/relational-ir`: Schema contract definition and validation
- `@prisma/sql`: Query builder and SQL compiler
- `@prisma/runtime`: Execution engine with plugin hooks
- Each package evolves independently and composes cleanly

### 4. Runtime Query Compilation
- Only PSL → IR → Types emission happens at build time
- Query compilation at runtime enables interactive development without client regeneration
- Verifiable Plans include metadata: referenced tables, columns, dialect, and contract hash

### 5. Extensible Plugin Framework
- First-class hook system for Plan lifecycle events (`beforeCompile`, `afterExecute`, `onError`)
- Composable linting, telemetry, query budgets, and policy enforcement
- No entanglement with core runtime logic

### 6. Type-Safe Query Shapes
- Result types derived from schema IR and explicit `select()` projection
- Correct nullability handling for left joins and nullable relations
- Type system ensures queries are both safe and accurate

## Architecture

```
PSL File → Parser → AST → IR Emitter → contract.json + schema.d.ts
                                              ↓
Query Builder ← Generated Types ← schema.d.ts
     ↓
SQL Compiler → Runtime (with Plugin Hooks) → PostgreSQL
```

The architecture decomposes Prisma's ORM into modular, contract-verified components where PSL defines a verifiable schema contract → IR encodes it deterministically → the runtime consumes it to safely compile, execute, and audit queries without codegen friction.

## Packages

- **`@prisma/relational-ir`** - Schema contract definition, validation, and serialization
- **`@prisma/psl`** - PSL lexer, recursive descent parser, and CLI
- **`@prisma/schema-emitter`** - AST → IR transformation and TypeScript code generation
- **`@prisma/sql`** - Type-safe query builder and PostgreSQL SQL compiler
- **`@prisma/runtime`** - Database connection, query execution, contract verification, and plugin hooks
- **`@prisma/orm`** - Optional ORM layer with relations and higher-level abstractions

## Quick Start

**First time here?** Start with our [Evaluation Guide](EVALUATION-GUIDE.md) for a guided walkthrough.

### Prerequisites
- Node.js >= 20
- pnpm 9.x
- PostgreSQL (for running the example)

### Installation & Setup

```bash
# Install dependencies and build
pnpm install && pnpm build

# Start PostgreSQL (Docker)
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# Create database table
psql -h localhost -U postgres -c "CREATE TABLE \"user\" (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, active BOOLEAN DEFAULT true, \"createdAt\" TIMESTAMP DEFAULT NOW());"

# Run the example
cd examples/todo-app
pnpm generate && pnpm start
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

The query builder uses Column objects that provide type-safe field access and automatic type inference:

```typescript
// Type-safe field access: t.user.id has type Column<number>
// Type-safe expressions: t.user.active.eq(true) returns Expression<boolean>
// Automatic type inference: Select results are typed based on Column types

const activeUsers = sql()
  .from('user')
  .where(t.user.active.eq(true))
  .select({ id: t.user.id, email: t.user.email });
// Returns: Array<{ id: number; email: string }>
```

### Generated Artifacts

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

## Testing

```bash
# Test all packages
pnpm test

# Test specific package
cd packages/sql && pnpm test

# Integration tests with PostgreSQL
cd examples/todo-app && pnpm test:integration
```

Integration tests spin up PostgreSQL, create tables, execute type-safe queries, and verify return types and error handling.

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
```

### Available Scripts

- `pnpm build` - Build all packages
- `pnpm test` - Run all tests
- `pnpm typecheck` - Type check all packages
- `pnpm lint` - Lint all packages

## API Reference

### Query Builder

```typescript
// Create a query builder
const query = sql().from('tableName');

// Add conditions and select fields
query.where(t.table.column.eq(value))
     .select({ alias: t.table.column })
     .orderBy('column', 'ASC')
     .limit(10);

// Execute with runtime
const results = await runtime.execute(query);
```

### Column Expressions

```typescript
// Equality and comparison
t.user.id.eq(1)
t.user.id.gt(5)
t.user.id.lt(10)
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
  verify: 'onFirstUse',
  plugins: [
    // Optional: add linting, telemetry, budgets, etc.
  ]
});

const results = await runtime.execute(query);
await runtime.end();
```
