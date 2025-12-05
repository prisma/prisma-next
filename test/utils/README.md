# @prisma-next/test-utils

Shared test utilities for Prisma Next test suites.

## Location

This package is located at `test/utils/` (not in `packages/`) as it is a test utility package, not a source package.

## Overview

The test-utils package provides shared generic test helpers used across multiple test suites in Prisma Next. It centralizes common testing patterns to reduce duplication and ensure consistency.

## Purpose

Provide reusable generic test utilities that DRY up common testing patterns across packages. Centralize database setup/teardown and async iterable utilities. This package has zero dependencies on other `@prisma-next/*` packages to avoid circular dependencies.

## Responsibilities

- **Database Management**: Create dev databases, manage connections, setup/teardown schemas
- **Async Iterable Utilities**: Collect and drain async iterables

**Non-goals:**
- Test-specific business logic
- Package-specific test utilities (those belong in package test directories)
- Runtime-specific utilities (see `@prisma-next/runtime/test/utils`)
- Contract-related utilities (see `test/e2e/framework/test/utils.ts`)

## Architecture

```mermaid
flowchart TD
    subgraph "Test Utils"
        DB[Database Helpers]
        ASYNC[Async Iterable Helpers]
    end

    subgraph "Test Suites"
        RUNTIME_TESTS[Runtime Tests]
        SQL_TESTS[SQL Query Tests]
        E2E_TESTS[E2E Tests]
        INTEGRATION[Integration Tests]
    end

    RUNTIME_TESTS --> DB
    RUNTIME_TESTS --> ASYNC
    SQL_TESTS --> ASYNC
    E2E_TESTS --> DB
    E2E_TESTS --> ASYNC
    INTEGRATION --> DB
    INTEGRATION --> ASYNC
```

**Note**: Runtime-specific utilities are in `@prisma-next/runtime/test/utils`, and contract-related utilities are in `test/e2e/framework/test/utils.ts`.

## Components

### Database Helpers

- `createDevDatabase(options?)`: Creates a dev database instance
- `withDevDatabase(fn, options?)`: Executes a function with a dev database, auto-cleanup
- `withClient(connectionString, fn)`: Executes a function with a database client, auto-cleanup
- `teardownTestDatabase(client, tables?)`: Tears down test database

### Async Iterable Helpers

- `collectAsync(iterable)`: Collects all values from an async iterable
- `drainAsyncIterable(iterable)`: Drains an async iterable without collecting

### Column Descriptors

Adapter-agnostic column type descriptors for test fixtures. These match common PostgreSQL types but don't depend on `@prisma-next/adapter-postgres` or any target-specific packages. Use these in test fixtures to avoid adapter/target dependencies.

**Available descriptors:**
- `int4Column`, `int2Column`, `int8Column`: Integer types
- `textColumn`: Text type
- `boolColumn`: Boolean type
- `float4Column`, `float8Column`: Floating-point types
- `timestampColumn`, `timestamptzColumn`: Timestamp types
- `vectorColumn`: pgvector vector type (for extension testing)

**Usage:**
```typescript
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

const contract = defineContract<Record<string, never>>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .build();
```

**Note**: These descriptors are dependency-free and match the `ColumnTypeDescriptor` shape from `@prisma-next/contract-authoring`, but are defined locally to keep test-utils dependency-free.

### Operation Descriptors

Adapter-agnostic operation type descriptors for type-level test fixtures. These match common PostgreSQL operation patterns but don't depend on any target-specific packages. Use these in type-level tests to avoid duplication.

**Available types:**
- `PgVectorOperations`: Operations for `pg/vector@1` (cosineDistance, l2Distance)
- `PgTextOperations`: Operations for `pg/text@1` (length)
- `CombinedTestOperations`: Combined type with both vector and text operations
- `OperationTypeSignature`: Base type for operation signatures

**Usage:**
```typescript
import type { PgVectorOperations, CombinedTestOperations } from '@prisma-next/test-utils/operation-descriptors';
import type { ColumnBuilder, OperationsForTypeId } from '@prisma-next/sql-relational-core/types';

// Use in type-level tests
type TestColumnBuilder = ColumnBuilder<
  'vector',
  { nativeType: 'vector'; codecId: 'pg/vector@1'; nullable: false },
  unknown,
  PgVectorOperations
>;

// Test operation type extraction
type VectorOps = OperationsForTypeId<'pg/vector@1', CombinedTestOperations>;
```

**Note**: These types are dependency-free and match the `OperationTypes` shape from `@prisma-next/sql-relational-core/types`, but are defined locally to keep test-utils dependency-free.

### Timeout Configuration

Centralized timeout values with environment variable support. All timeouts respect the `TEST_TIMEOUT_MULTIPLIER` environment variable (set to `3` in CI).

- `timeouts.spinUpPpgDev`: Timeout for hooks that spin up ppg-dev (PostgreSQL dev server). Base: 15000ms
- `timeouts.typeScriptCompilation`: Timeout for tests that perform TypeScript compilation. Base: 8000ms
- `timeouts.default`: Default timeout for general tests. Base: 100ms

**Usage:**
```typescript
import { timeouts } from '@prisma-next/test-utils';

beforeAll(async () => {
  // Database setup
}, timeouts.spinUpPpgDev);

it('compiles TypeScript', async () => {
  // TypeScript compilation
}, timeouts.typeScriptCompilation);
```

**Note**: For runtime-specific utilities (plan execution, runtime creation, contract markers), see `@prisma-next/runtime/test/utils`. For contract-related utilities (contract loading, emission verification), see `test/e2e/framework/test/utils.ts`.

## Dependencies

**Zero dependencies on other `@prisma-next/*` packages** - This allows test-utils to be used by all packages without circular dependencies.

**External dependencies (devDependencies only):**
- `@prisma/dev`: Dev database server
- `pg`: PostgreSQL client

## Usage

### Integration Tests

```typescript
import {
  withDevDatabase,
  withClient,
  teardownTestDatabase,
  collectAsync,
  drainAsyncIterable,
} from '@prisma-next/test-utils';

// Use with dev database
await withDevDatabase(async ({ connectionString }) => {
  await withClient(connectionString, async (client) => {
    // ... test code ...

    // Collect async iterable
    const results = await collectAsync(someAsyncIterable);

    // Or drain without collecting
    await drainAsyncIterable(someAsyncIterable);

    await teardownTestDatabase(client);
  });
});
```

**For runtime-specific utilities**, import from `@prisma-next/runtime/test/utils`:
```typescript
import {
  executePlanAndCollect,
  drainPlanExecution,
  setupTestDatabase,
  createTestRuntime,
  createTestRuntimeFromClient,
} from '@prisma-next/sql-runtime/test/utils';
```

**For contract-related utilities in E2E tests**, import from local `./utils`:
```typescript
import { loadContractFromDisk, emitAndVerifyContract } from './utils';
```

## Exports

- `.`: All test utilities (database helpers, async iterable helpers, column descriptors, operation descriptors, timeouts)
- `./column-descriptors`: Adapter-agnostic column type descriptors for test fixtures
- `./operation-descriptors`: Adapter-agnostic operation type descriptors for type-level test fixtures

