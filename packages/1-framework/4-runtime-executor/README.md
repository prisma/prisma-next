# @prisma-next/runtime-executor

Target-agnostic execution engine for Prisma Next.

## Package Classification

- **Domain**: framework
- **Layer**: runtime-executor
- **Plane**: runtime

## Overview

The runtime-executor package provides the target-neutral execution engine responsible for plan validation, marker verification, plugin lifecycle, telemetry, and the runtime SPI definition. It is designed to work with any target family (SQL, document, graph, etc.) through the `RuntimeFamilyAdapter` interface.

## Purpose

Provide a target-agnostic execution engine that family runtimes (e.g., `@prisma-next/sql-runtime`) can compose with family-specific adapters, drivers, and codecs.

## Responsibilities

- **Plan Validation**: Verify plans against contracts (storageHash/profileHash checks)
- **Marker Verification**: Read and parse contract markers from databases
- **Plugin Orchestration**: Manage plugin lifecycle (beforeExecute, onRow, afterExecute hooks)
- **Telemetry Recording**: Track execution metrics (lane, target, fingerprint, outcome, duration)
- **Error Envelopes**: Provide consistent error formatting across families
- **Runtime SPI**: Define the `RuntimeFamilyAdapter` interface that family runtimes implement

## Key Abstractions

### RuntimeFamilyAdapter

Family runtimes implement this interface to provide:
- `readMarkerStatement()` - Returns SQL/query statement to read marker
- `validatePlan(plan, contract)` - Family-specific plan validation
- `contract` - The family-specific contract type

### RuntimeCore

The target-neutral runtime implementation that:
- Takes a `RuntimeFamilyAdapter` and driver
- Executes plans through the family adapter
- Orchestrates plugins
- Records telemetry
- Validates plans and markers

## Dependencies

- `@prisma-next/contract` - Plan types
- `@prisma-next/operations` - Operation registry

**No SQL-specific dependencies** - This package is target-agnostic.

## Usage

Family runtimes (e.g., `@prisma-next/sql-runtime`) compose runtime-executor with family-specific implementations:

```typescript
import { createRuntimeCore } from '@prisma-next/runtime-executor';
import { SqlFamilyAdapter } from './sql-family-adapter';

const familyAdapter = new SqlFamilyAdapter(contract);
const core = createRuntimeCore({
  familyAdapter,
  driver,
  verify: { mode: 'onFirstUse', requireMarker: false },
  operationRegistry,
  plugins: [],
});
```

## Exports

- `createRuntimeCore` - Create a target-neutral runtime instance
- `RuntimeFamilyAdapter` - Interface for family runtimes
- `MarkerReader` - Interface for marker reading
- `runtimeError` - Error envelope utilities
- `computeSqlFingerprint` - SQL fingerprint computation
- `parseContractMarkerRow` - Marker parsing utilities

**Note:** The `lints` and `budgets` plugins have been migrated to the SQL domain. Import them from `@prisma-next/sql-runtime` instead.

## Testing

Includes a mock-family smoke test (`test/mock-family.test.ts`) that proves runtime-executor can work without SQL dependencies.
