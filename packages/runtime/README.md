# @prisma-next/runtime

Runtime execution engine that verifies contracts, executes queries, and applies guardrails.

## Overview

The runtime is the executable core of Prisma Next. It orchestrates query execution through a deterministic pipeline: contract verification, plugin guardrails, adapter lowering, and codec decoding. Every query is compiled into a Plan, and every Plan passes through verification and a plugin pipeline before execution.

The runtime follows a "thin core, fat targets" philosophy: it contains no dialect-specific logic, no transport/pooling code, and no policy enforcement. Instead, it coordinates adapters, drivers, and plugins to deliver deterministic behavior with tight feedback loops.

## Purpose

Execute query Plans with deterministic verification, guardrails, and feedback. Provide a unified execution surface that works across all query lanes (DSL, ORM, Raw SQL, TypedSQL).

## Responsibilities

- **Contract Verification**: Verify loaded contract against database marker (`coreHash` and `profileHash`)
- **Plan Execution**: Execute Plans through adapters and drivers
- **Plugin Pipeline**: Apply guardrails (lints, budgets, telemetry) before and during execution
- **Result Streaming**: Stream results as `AsyncIterable<Row>` for efficient processing
- **Error Mapping**: Map driver errors to stable `RuntimeError` envelope

**Non-goals:**
- Migration planning or execution
- Dialect-specific SQL lowering (adapters)
- Transport/pooling management (drivers)
- Policy definition (plugins)

## Architecture

```mermaid
flowchart TD
    subgraph "Runtime Core"
        RT[Runtime]
        VERIFY[Contract Verification]
        PLUGIN[Plugin Pipeline]
        CODEC[Codec Registry]
    end

    subgraph "Guardrails"
        LINT[Lint Plugins]
        BUDGET[Budget Plugins]
        TELEMETRY[Telemetry Plugins]
    end

    subgraph "Execution"
        ADAPTER[Adapter]
        DRIVER[Driver]
        DB[(Database)]
    end

    subgraph "Contracts"
        CT[Contract]
        MARKER[Marker Table]
    end

    PLAN[Plan] --> RT
    RT --> VERIFY
    VERIFY --> MARKER
    VERIFY --> PLUGIN
    PLUGIN --> LINT
    PLUGIN --> BUDGET
    PLUGIN --> TELEMETRY
    PLUGIN --> ADAPTER
    ADAPTER --> CODEC
    ADAPTER --> DRIVER
    DRIVER --> DB
    DB --> DRIVER
    DRIVER --> RT
    RT --> STREAM[AsyncIterable<Row>]
    CT --> RT
```

## Components

### Runtime (`runtime.ts`)
- Main orchestrator for query execution
- Manages contract verification, plugin lifecycle, and result streaming
- Coordinates adapters, drivers, codecs, and operations registry
- Uses `RuntimeContext` for codec and operations registries (decoupled from runtime)

### RuntimeContext (`context.ts`)
- Encapsulates `SqlContract`, `OperationRegistry`, and `CodecRegistry`
- Decouples contract and registries from `Runtime`, allowing them to be passed to schema/query builders
- Composes codecs and operations from adapters and extensions programmatically
- **Contract Storage**: Contract is stored in context (caller validates before passing)
- **Extension Interface**: Extensions provide `codecs?()` and `operations?()` methods
- **Adapter as Extension**: Adapters are treated as extensions (provide codecs via `profile.codecs()`)
- **Signature**: `createRuntimeContext({ contract, adapter, extensions })` - contract must be validated before passing
- No file I/O at runtime - everything is bundled

### Codecs (`codecs/`)
- **Encoding**: Encode JavaScript values to wire format for parameters
- **Decoding**: Decode wire format values to JavaScript types
- **Validation**: Validate decoded values against contract types
- **JSON Array Decoding**: Special handling for `includeMany` results - detects `include:alias` markers in plan metadata and parses JSON arrays from include aliases, converting `NULL` to empty arrays `[]` for consistency

### Plugins (`plugins/`)
- **Lints**: Pre-execution validation and warnings
- **Budgets**: Resource limit enforcement (rows, latency)
- **Types**: Type inference and validation

### Guardrails (`guardrails/`)
- **Raw**: Guardrails for raw SQL execution

### Diagnostics (`diagnostics.ts`)
- Error taxonomy and mapping
- Structured error reporting

### Marker (`marker.ts`)
- Contract marker verification
- Database alignment checks

### Fingerprint (`fingerprint.ts`)
- Plan fingerprinting for caching and identity

## Dependencies

- **`@prisma-next/sql-query`**: Plan types and SQL contract types
- **`@prisma-next/sql-target`**: Adapter SPI, codec interfaces, SQL contract types
- **`@prisma-next/driver-postgres`**: Postgres driver implementation

## Related Subsystems

- **[Runtime & Plugin Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)**: Detailed subsystem specification
- **[Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)**: Adapter and driver interfaces

## Related ADRs

- [ADR 002 - Plans are Immutable](../../docs/architecture%20docs/adrs/ADR%20002%20-%20Plans%20are%20Immutable.md)
- [ADR 003 - One Query One Statement](../../docs/architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)
- [ADR 011 - Unified Plan Model](../../docs/architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 014 - Runtime Hook API](../../docs/architecture%20docs/adrs/ADR%20014%20-%20Runtime%20Hook%20API.md)
- [ADR 021 - Contract Marker Storage](../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)
- [ADR 022 - Lint Rule Taxonomy](../../docs/architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)
- [ADR 023 - Budget Evaluation](../../docs/architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)
- [ADR 030 - Result decoding & codecs registry](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20&%20codecs%20registry.md)
- [ADR 124 - Unified Async Iterable Execution Surface](../../docs/architecture%20docs/adrs/ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)
- [ADR 125 - Execution Mode Selection & Streaming Semantics](../../docs/architecture%20docs/adrs/ADR%20125%20-%20Execution%20Mode%20Selection%20&%20Streaming%20Semantics.md)

## Usage

```typescript
import { createRuntime, createRuntimeContext } from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres';
import { createPostgresDriver } from '@prisma-next/driver-postgres';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import pgVector from '@prisma/extension-pg-vector';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// Validate contract first (caller is responsible for validation)
const contract = validateContract<Contract>(contractJson);

// Create adapter
const adapter = createPostgresAdapter();

// Create context with validated contract, adapter, and extensions (programmatic registration)
const context = createRuntimeContext({
  contract,  // Contract is stored in context
  adapter,
  extensions: [pgVector()],  // Extensions provide codecs and operations programmatically
});

// Create runtime with context (contract comes from context)
const runtime = createRuntime({
  adapter,
  driver: createPostgresDriver({ connectionString: process.env.DATABASE_URL }),
  verify: { mode: 'onFirstUse', requireMarker: false },
  context,  // Pass context to runtime (includes contract)
  plugins: [
    // Add lints, budgets, telemetry plugins
  ],
});

// Use context in schema (types extracted automatically from contract)
const tables = schema(context).tables;

// Execute a plan
for await (const row of runtime.execute(plan)) {
  console.log(row);
}
```

### Extension Interface

Extensions provide `codecs?()` and `operations?()` methods programmatically. No file I/O at runtime - everything is bundled:

```typescript
interface Extension {
  codecs?(): CodecRegistry;
  operations?(): ReadonlyArray<OperationSignature>;
}
```

**Adapter as Extension**: Adapters are treated as extensions (provide codecs via `profile.codecs()`). The adapter is automatically included in the context when creating it.

## Exports

- `.`: Main runtime API (`createRuntime`, `createRuntimeContext`, `RuntimeContext`, `Extension`, types)
- `./test/utils`: Runtime-specific test utilities

### Test Utilities

Runtime-specific test utilities are located in `runtime/test/utils.ts`. These utilities import generic helpers from `@prisma-next/test-utils` and provide runtime-specific functionality:

**Available Utilities:**
- `executePlanAndCollect<P extends Plan>(runtime, plan)`: Executes a plan and collects all results into an array. The return type is automatically inferred from the plan's type parameter using `ResultType<P>[]`.
- `drainPlanExecution(runtime, plan)`: Drains a plan execution, consuming all results without collecting them.
- `executeStatement(client, statement)`: Executes a SQL statement on a database client.
- `setupTestDatabase(client, contract, setupFn)`: Sets up database schema and data, then writes the contract marker.
- `writeTestContractMarker(client, contract)`: Writes a contract marker to the database.
- `createTestRuntime(contract, adapter, driver, options?)`: Creates a runtime with standard test configuration.
- `createTestRuntimeFromClient(contract, client, adapter, options?)`: Creates a runtime with the given contract and database client.
- `setupE2EDatabase(client, contract, setupFn)`: Sets up E2E test database (wrapper around `setupTestDatabase`).

**Usage:**
```typescript
import {
  executePlanAndCollect,
  drainPlanExecution,
  setupTestDatabase,
  createTestRuntime,
  createTestRuntimeFromClient,
} from '@prisma-next/runtime/test/utils';
import { withClient } from '@prisma-next/test-utils';

await withClient(connectionString, async (client) => {
  await setupTestDatabase(client, contract, async (c) => {
    await c.query('create table "user" ...');
  });

  const runtime = createTestRuntime(contract, adapter, driver);
  const rows = await executePlanAndCollect(runtime, plan);
});
```

**Note**: These utilities import generic helpers (`drainAsyncIterable`, `collectAsync`, `createDevDatabase`, `withClient`) from `@prisma-next/test-utils` to avoid circular dependencies.

