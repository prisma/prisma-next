# @prisma-next/sql-runtime

SQL runtime implementation for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: runtime
- **Plane**: runtime

## Overview

The SQL runtime package implements the SQL family runtime by composing `@prisma-next/runtime-executor` with SQL-specific adapters, drivers, and codecs. It provides the public runtime API for SQL-based databases.

## Purpose

Execute SQL query Plans with deterministic verification, guardrails, and feedback. Provide a unified execution surface that works across all SQL query lanes (DSL, ORM, Raw SQL).

## Responsibilities

- **SQL Context Creation**: Create runtime contexts with SQL contracts, adapters, and codecs
- **SQL Marker Management**: Provide SQL statements for reading/writing contract markers
- **Codec Encoding/Decoding**: Encode parameters and decode rows using SQL codec registries
- **Codec Validation**: Validate that codec registries contain all required codecs
- **SQL Family Adapter**: Implement `RuntimeFamilyAdapter` for SQL contracts
- **SQL Runtime**: Compose runtime-executor with SQL-specific logic

## Dependencies

- `@prisma-next/runtime-executor` - Target-neutral execution engine
- `@prisma-next/sql-contract` - SQL contract types
- `@prisma-next/sql-target` - SQL family interfaces (legacy transitional package)
- `@prisma-next/operations` - Operation registry

## Usage

```typescript
import { createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres';
import { createPostgresDriver } from '@prisma-next/driver-postgres/runtime';

const contract = validateContract<Contract>(contractJson);
const adapter = createPostgresAdapter();

const context = createRuntimeContext({
  contract,
  adapter,
  extensions: [pgVector()],
});

const runtime = createRuntime({
  adapter,
  driver: createPostgresDriver({ connectionString: process.env.DATABASE_URL }),
  verify: { mode: 'onFirstUse', requireMarker: false },
  context,
  plugins: [budgets(), lints()],
});

for await (const row of runtime.execute(plan)) {
  console.log(row);
}
```

## Exports

- `createRuntime` - Create a SQL runtime instance
- `createRuntimeContext` - Create a SQL runtime context
- `RuntimeContext`, `Extension` - Context types
- `budgets`, `lints` - SQL-compatible plugins (re-exported from runtime-executor)
- `readContractMarker`, `writeContractMarker` - SQL marker statements
- `encodeParams`, `decodeRow` - Codec encoding/decoding utilities
- `validateCodecRegistryCompleteness` - Codec validation

## Architecture

The SQL runtime composes runtime-executor with SQL-specific implementations:

1. **SqlFamilyAdapter**: Implements `RuntimeFamilyAdapter` for SQL contracts
2. **SqlRuntime**: Wraps `RuntimeCore` and adds SQL-specific encoding/decoding
3. **SqlContext**: Creates contexts with SQL contracts, adapters, and codecs
4. **SqlMarker**: Provides SQL statements for marker management

## Testing

Unit tests verify:
- Context creation with extensions
- Codec encoding/decoding
- Codec validation
- Marker statement generation
- Runtime execution with SQL adapters
