# Todo App Example

This example demonstrates the complete TypeScript query DSL prototype with type-safe queries, contract verification, and integration testing.

## Features Demonstrated

- **PSL Schema Definition**: Define data models using Prisma Schema Language
- **Type-Safe Query Building**: Use Column objects for type-safe SQL queries
- **Automatic Type Inference**: Query results are automatically typed
- **Contract Hash Verification**: Ensure application and database schema alignment
- **Schema Verification**: Runtime verification of table/column existence
- **Integration Testing**: Full database integration tests using `@prisma/dev`

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm 9.x

### Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build packages**:
   ```bash
   pnpm build
   ```

3. **Generate schema files**:
   ```bash
   pnpm generate
   ```

### Running the Example

1. **Start PostgreSQL** (using Docker):
   ```bash
   docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
   ```

2. **Set up the database with contract verification**:
   ```bash
   pnpm setup-db
   ```
   This creates:
   - `prisma_contract.version` table for contract hash storage
   - `user` table from your schema
   - Seeds the contract hash from your generated schema

3. **Run the example**:
   ```bash
   pnpm start
   ```

### Running Tests

```bash
# Unit tests
pnpm test

# Integration tests (requires PostgreSQL)
pnpm test:integration
```

## Contract Hash Verification

The contract verifier ensures your application's compiled schema matches the database's applied schema. This prevents runtime errors from schema mismatches.

### Basic Usage

```typescript
import { connect, assertContract } from '@prisma/runtime';
import schema from './schema.json';

const db = connect({ ir: schema, database: { ... } });

// Verify contract at startup - fails fast if mismatched
await assertContract({ expectedHash: schema.contractHash, client: db.pool });
```

That's it! If the database schema doesn't match your application, it throws an actionable error.

### Alternative: Non-Throwing Verification

```typescript
import { verifyContract } from '@prisma/runtime';

// Non-throwing verification with custom handling
const result = await verifyContract({
  expectedHash: schema.contractHash,
  client: db.pool,
  mode: 'warn' // Log warnings instead of throwing
});

if (!result.ok) {
  console.warn('Contract mismatch:', result);
  // Custom handling logic here
}
```

### Health Check Pattern

```typescript
// Health check endpoint
const healthCheck = async () => {
  const result = await verifyContract({
    expectedHash: schema.contractHash,
    client: db.pool,
    mode: 'warn'
  });

  return {
    status: result.ok ? 'healthy' : 'degraded',
    contract: result.ok ? 'valid' : 'mismatch',
    details: result,
    timestamp: new Date().toISOString()
  };
};
```

### Error Scenarios

The verifier handles two main error scenarios:

1. **E_CONTRACT_MISSING**: No contract hash row found in database
2. **E_CONTRACT_MISMATCH**: Database hash differs from application hash

Both errors include actionable remediation hints.

## Code Examples

### Schema Definition

```prisma
// schema.psl
model User {
  id        Int        @id @default(autoincrement())
  email     String     @unique
  active    Boolean    @default(true)
  createdAt DateTime   @default(now())
}
```

### Type-Safe Queries

```typescript
// src/queries.ts
import { sql, t } from '@prisma/sql';
import { db } from './db';

export async function getActiveUsers() {
  const query = sql()
    .from('user')
    .where(t.user.active.eq(true))
    .select({ id: t.user.id, email: t.user.email });

  // Return type is inferred as Array<{ id: number; email: string }>
  return await db.execute(query.build());
}

export async function getUserById(id: number) {
  const query = sql()
    .from('user')
    .where(t.user.id.eq(id))
    .select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt
    });

  const results = await db.execute(query.build());
  return results[0] || null;
}
```

### Database Connection

```typescript
// src/db.ts
import { connect } from '@prisma/runtime';
import ir from '../.prisma/contract.json' assert { type: 'json' };

export const db = connect({
  ir: ir as Schema,
  verify: 'onFirstUse',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});
```

## Type Safety Features

### Column-Based API

The query builder uses Column objects that provide:

- **Type-safe field access**: `t.user.id` has type `Column<number>`
- **Type-safe expressions**: `t.user.active.eq(true)` returns `Expression<boolean>`
- **Automatic type inference**: Select results are typed based on Column types

### Generated Types

The schema emitter generates TypeScript types:

```typescript
// Generated .prisma/schema.d.ts
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

## Integration Testing

The integration tests demonstrate:

- **Database Setup**: Automatic PostgreSQL setup using `@prisma/dev`
- **Schema Generation**: Programmatic schema file generation
- **Query Execution**: Type-safe query execution with real database
- **Type Verification**: Runtime type checking and verification
- **Error Handling**: Proper error handling for unknown tables/columns

### Test Structure

```typescript
// src/test/integration.test.ts
describe('Integration Tests', () => {
  beforeAll(async () => {
    // Start PostgreSQL using @prisma/dev
    // Generate schema files
    // Create tables and insert test data
  });

  it('executes getActiveUsers query with correct type inference', async () => {
    const query = sql()
      .from('user')
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const results = await db.execute(query.build());

    // Type should be inferred as Array<{ id: number; email: string }>
    expect(results).toHaveLength(2);
    expect(typeof results[0].id).toBe('number');
    expect(typeof results[0].email).toBe('string');
  });
});
```

## Scripts

- `pnpm build` - Build TypeScript files
- `pnpm dev` - Watch mode for development
- `pnpm start` - Run the example application with contract verification
- `pnpm generate` - Generate schema files from PSL
- `pnpm setup-db` - Set up database with contract version table
- `pnpm test` - Run unit tests
- `pnpm test:integration` - Run integration tests
- `pnpm lint` - Lint TypeScript files
- `pnpm typecheck` - Type check without building

## Environment Variables

- `DB_HOST` - Database host (default: localhost)
- `DB_PORT` - Database port (default: 5432)
- `DB_NAME` - Database name (default: postgres)
- `DB_USER` - Database user (default: postgres)
- `DB_PASSWORD` - Database password (default: postgres)
