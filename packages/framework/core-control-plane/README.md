# @prisma-next/core-control-plane

Control plane domain actions, config types, validation, and error factories for Prisma Next.

## Overview

This package provides the core domain logic for control plane operations (contract emission, database verification) without any file I/O or CLI awareness. It's part of the core layer and can be used programmatically or by the CLI layer.

## Responsibilities

- **Config Types**: Type definitions for Prisma Next configuration (`PrismaNextConfig`, `FamilyDescriptor`, etc.)
- **Config Validation**: Pure validation logic for config structure (no file I/O)
- **Config Normalization**: `defineConfig()` function for normalizing config with defaults
- **Domain Actions**:
  - `verifyDatabase()`: Verifies database contract markers (accepts config object and ContractIR)

Note: Contract emission is implemented on family instances (e.g., `familyInstance.emitContract()`), not as a core domain action.
- **Error Factories**: Domain error factories (`CliStructuredError`, config errors, runtime errors)
- **Pack Manifest Types**: Type definitions for extension pack manifests

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

## Package Location

This package is part of the **framework domain**, **core layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: migration (control plane operations)
- **Path**: `packages/framework/core-control-plane`

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)


