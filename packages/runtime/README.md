# @prisma/runtime

Database connection management, query execution, contract verification, and plugin system.

## Goals

- Provide database connection and query execution primitives
- Enable contract verification and drift detection
- Support extensible plugin system for runtime behavior
- Offer both simple and advanced runtime configurations
- Ensure query safety through contract hash verification

## Architecture

The package consists of several key components:

- **DatabaseConnection**: Basic connection and query execution
- **Runtime**: Plugin-enabled runtime with hooks
- **Contract Verification**: Verifies queries against data contracts
- **Plugin System**: Extensible hooks for before/after execution
- **Built-in Plugins**: Lint rules, verification, and other guardrails

## Installation

```bash
# In a workspace environment
pnpm add @prisma/runtime
```

## Exports

### Main Export

- `DatabaseConnection` - Basic connection and execution
- `Runtime` / `createRuntime()` - Plugin-enabled runtime
- `verifyContract()`, `assertContract()` - Contract verification
- Plugin system types and built-in plugins (lint, verification)

### Sub-exports

- `@prisma/runtime/connection` - Connection primitives

## Usage Examples

### Basic Database Connection

```typescript
import { DatabaseConnection } from '@prisma/runtime';
import contractIR from './contract.json';
import { sql, makeT } from '@prisma/sql';

const db = new DatabaseConnection({
  ir: contractIR,
  database: {
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'postgres',
    password: 'password'
  }
});

const t = makeT(contractIR);
const query = sql
  .from(t.user)
  .select({ id: t.user.id, email: t.user.email })
  .limit(10);

const results = await db.execute(query.build());
console.log(results);
```

### Plugin-Enabled Runtime

```typescript
import { createRuntime, DatabaseConnection, lint } from '@prisma/runtime';
import contractIR from './contract.json';

const driver = new DatabaseConnection({ ir: contractIR });

const runtime = createRuntime({
  ir: contractIR,
  driver,
  plugins: [
    lint({
      rules: {
        'no-select-star': 'error',
        'mutation-requires-where': 'error',
        'no-missing-limit': 'warn',
        'no-unindexed-column-in-where': 'warn'
      }
    })
  ]
});

// Queries will be linted before execution
const results = await runtime.execute(query.build());
```

### Contract Verification

```typescript
import { verifyContract, assertContract } from '@prisma/runtime';

// Verify contract against database
const verification = await verifyContract(contractIR, {
  connectionString: process.env.DATABASE_URL
});

if (!verification.isValid) {
  console.error('Contract verification failed:', verification.errors);
}

// Assert contract (throws on failure)
try {
  await assertContract(contractIR, {
    connectionString: process.env.DATABASE_URL
  });
  console.log('Contract is valid!');
} catch (error) {
  console.error('Contract assertion failed:', error.message);
}
```

### Custom Plugins

```typescript
import { createRuntime, RuntimePlugin } from '@prisma/runtime';

const customPlugin: RuntimePlugin = {
  async beforeExecute({ plan, ir }) {
    console.log(`Executing query: ${plan.sql}`);
    console.log(`Contract hash: ${plan.meta.contractHash}`);
  },

  async afterExecute({ plan, result, metrics }) {
    console.log(`Query completed in ${metrics.durationMs}ms`);
    console.log(`Returned ${result.rowCount} rows`);
  },

  async onError({ plan, error }) {
    console.error(`Query failed: ${error.message}`);
    console.error(`SQL: ${plan.sql}`);
  }
};

const runtime = createRuntime({
  ir: contractIR,
  driver,
  plugins: [customPlugin]
});
```

### Built-in Lint Rules

```typescript
import { createRuntime, lint, GuardrailError } from '@prisma/runtime';

const runtime = createRuntime({
  ir: contractIR,
  driver,
  plugins: [
    lint({
      rules: {
        // Prevent SELECT * queries
        'no-select-star': 'error',

        // Require WHERE clauses on mutations
        'mutation-requires-where': 'error',

        // Warn about unbounded queries
        'no-missing-limit': 'warn',

        // Warn about unindexed WHERE columns
        'no-unindexed-column-in-where': 'warn'
      }
    })
  ]
});

try {
  // This will throw GuardrailError due to SELECT *
  const results = await runtime.execute(selectStarQuery.build());
} catch (error) {
  if (error instanceof GuardrailError) {
    console.error(`Lint error: ${error.verdict.message}`);
  }
}
```

### Verification Plugin

```typescript
import { createRuntime, verification } from '@prisma/runtime';

const runtime = createRuntime({
  ir: contractIR,
  driver,
  plugins: [
    verification({
      mode: 'onFirstUse', // 'always' | 'onFirstUse' | 'never'
      connectionString: process.env.DATABASE_URL
    })
  ]
});

// Queries will be verified against database schema on first execution
const results = await runtime.execute(query.build());
```

### Runtime Configuration

```typescript
import { createRuntime, RuntimeConfig } from '@prisma/runtime';

const config: RuntimeConfig = {
  // Global query timeout
  queryTimeout: 30000,

  // Maximum rows per query
  maxRows: 10000,

  // Contract mismatch handling
  contractMismatchMode: 'error' // 'error' | 'warn' | 'ignore'
};

const runtime = createRuntime({
  ir: contractIR,
  driver,
  config,
  plugins: [/* ... */]
});
```

### Plugin Registration Patterns

```typescript
import { createRuntime } from '@prisma/runtime';

// Factory-time registration
const runtime = createRuntime({
  ir: contractIR,
  driver,
  plugins: [lint({ rules: { 'no-select-star': 'error' } })]
});

// Instance-time registration
const runtime2 = createRuntime({ ir: contractIR, driver });
runtime2.use(lint({ rules: { 'no-select-star': 'error' } }));
runtime2.use(customPlugin);
```

## Related Packages

- **Dependencies**:
  - `@prisma/relational-ir` - Schema context and contract verification
  - `@prisma/sql` - Query execution
- **Used by**:
  - Applications requiring database connectivity
  - Higher-level abstractions and frameworks

## Design Principles

- **Composable Primitives**: Plugin system enables composable runtime behavior
- **Contract-First**: All operations verify against the data contract
- **Type Safety**: Full TypeScript support with proper inference
- **Extensibility**: Plugin system supports custom runtime behavior
- **Performance**: Zero overhead when no plugins are registered
- **Transparency**: Clear execution flow with visible hooks
- **AI-Friendly**: Plugin system enables agent-based runtime customization
