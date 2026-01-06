# @prisma-next/core-control-plane

Control plane domain actions, config types, validation, and error factories for Prisma Next.

## Overview

This package provides the core domain logic for control plane operations (contract emission, database verification) without any file I/O or CLI awareness. It's part of the core layer and can be used programmatically or by the CLI layer.

## Responsibilities

- **Config Types**: Type definitions for Prisma Next configuration (`PrismaNextConfig`, `ControlFamilyDescriptor`, `ControlTargetDescriptor`, `ControlAdapterDescriptor`, `ControlDriverDescriptor`, `ControlExtensionDescriptor`)
- **ControlPlaneStack**: A struct bundling `target`, `adapter`, `driver`, and `extensionPacks` for control plane operations. Use `createControlPlaneStack()` to construct with sensible defaults.
- **Config Validation**: Pure validation logic for config structure (no file I/O)
- **Config Normalization**: `defineConfig()` function for normalizing config with defaults
- **Domain Actions**:
  - `verifyDatabase()`: Verifies database contract markers (accepts config object and ContractIR)

Note: Contract emission is implemented on the SQL family instance (e.g., `familyInstance.emitContract()`), not as a core domain action.
- **Error Factories**: Domain error factories (`CliStructuredError`, config errors, runtime errors)
- **Pack Manifest Types**: Type definitions for extension pack manifests
- **Migration SPI**: Generic migration planner/runner interfaces (`MigrationPlanner<TFamilyId, TTargetId>`, `MigrationRunner<TFamilyId, TTargetId>`, `TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>`) that thread family/target IDs for compile-time component compatibility enforcement
  - `MigrationRunnerFailure` includes optional `meta` for structured debugging context (e.g., schema issues, SQL state)

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` - ContractIR types
  - `@prisma-next/emitter` - TargetFamilyHook, emit function
  - `@prisma-next/operations` - OperationRegistry
  - `arktype` - Validation

- **Depended on by**:
  - `@prisma-next/cli` - CLI layer uses domain actions

## Architecture

```mermaid
flowchart TD
    subgraph "Core Layer"
        CCP[@prisma-next/core-control-plane]
    end

    subgraph "Tooling Layer"
        CLI[@prisma-next/cli]
    end

    CLI -->|uses| CCP
```

## Usage

### Config Types and Validation

```typescript
import { defineConfig, validateConfig, type PrismaNextConfig } from '@prisma-next/core-control-plane/config-types';
import { validateConfig } from '@prisma-next/core-control-plane/config-validation';

// Define and normalize config
const config = defineConfig({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  contract: {
    source: contractBuilder,
    output: 'src/prisma/contract.json',
  },
});

// Validate config structure (pure validation, no file I/O)
validateConfig(config);
```

### ControlPlaneStack

The `ControlPlaneStack` bundles component descriptors for control plane operations (creating family instances, running CLI commands, connecting to databases):

```typescript
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import type { ControlPlaneStack } from '@prisma-next/core-control-plane/types';

// Create a stack with sensible defaults
const stack = createControlPlaneStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver, // optional, defaults to undefined
  extensionPacks: [pgvector], // optional, defaults to []
});

// Use stack for family instance creation
const familyInstance = config.family.create(stack);

// Stack is also used internally by ControlClient and CLI commands
```

**Stack shape after construction:**
- `target`: Required target descriptor
- `adapter`: Required adapter descriptor
- `driver`: `ControlDriverDescriptor | undefined` (always present, may be `undefined`)
- `extensionPacks`: `readonly ControlExtensionDescriptor[]` (always an array, possibly empty)

### Verify Database

```typescript
import { verifyDatabase } from '@prisma-next/core-control-plane/verify-database';

// Verify database - accepts config object and ContractIR (no file loading)
const result = await verifyDatabase({
  config: loadedConfig,
  contractIR: parsedContract,
  dbUrl: connectionString,
  contractPath: 'src/prisma/contract.json',
  configPath: 'prisma-next.config.ts',
});

if (result.ok) {
  console.log('Database matches contract');
} else {
  console.error(`Verification failed: ${result.summary}`);
}
```

### Error Factories

```typescript
import {
  errorConfigFileNotFound,
  errorMarkerMissing,
  errorHashMismatch,
} from '@prisma-next/core-control-plane/errors';

throw errorConfigFileNotFound('prisma-next.config.ts', {
  why: 'Config file not found in current directory',
});
```

## Migration SPI Design

The migration planner/runner interfaces are generic over `TFamilyId` and `TTargetId` to enable compile-time enforcement of component compatibility:

- **`MigrationPlanner<TFamilyId, TTargetId>`**: Generic planner interface that accepts `TargetBoundComponentDescriptor<TFamilyId, TTargetId>[]`
- **`MigrationRunner<TFamilyId, TTargetId>`**: Generic runner interface that accepts `TargetBoundComponentDescriptor<TFamilyId, TTargetId>[]`
- **`TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>`**: Generic capability interface for targets that support migrations

The CLI performs runtime validation at the composition boundary using `assertFrameworkComponentsCompatible()` before calling typed planner/runner instances. This validates that all components have matching `familyId` and `targetId`, then returns a typed `TargetBoundComponentDescriptor` array that satisfies the planner/runner interface requirements.

```typescript
// CLI composition boundary - runtime assertion + type narrowing
const rawComponents = [config.target, config.adapter, ...(config.extensionPacks ?? [])];
const frameworkComponents = assertFrameworkComponentsCompatible(
  config.family.familyId,
  config.target.targetId,
  rawComponents,
);

// Now frameworkComponents is typed as TargetBoundComponentDescriptor<TFamilyId, TTargetId>[]
const planner = target.migrations.createPlanner(sqlFamilyInstance);
planner.plan({ contract, schema, policy, frameworkComponents });
```

## Package Location

This package is part of the **framework domain**, **core layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: migration (control plane operations)
- **Path**: `packages/1-framework/1-core/migration/control-plane`

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)


