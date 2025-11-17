# @prisma-next/core-control-plane

Control plane domain actions, config types, validation, and error factories for Prisma Next.

## Overview

This package provides the core domain logic for control plane operations (contract emission, database verification) without any file I/O or CLI awareness. It's part of the core layer and can be used programmatically or by the CLI layer.

## Responsibilities

- **Config Types**: Type definitions for Prisma Next configuration (`PrismaNextConfig`, `FamilyDescriptor`, `TargetFamilyContext`, etc.)
- **Config Validation**: Pure validation logic for config structure (no file I/O)
- **Config Normalization**: `defineConfig()` function for normalizing config with defaults
- **Domain Actions**:
  - `emitContract()`: Emits contract JSON and DTS as strings (no file I/O)
  - `verifyDatabase()`: Verifies database contract markers (accepts descriptors, driver, and ContractIR)
  - `verifyDatabaseSchema()`: Verifies that the live database schema satisfies the contract (family-agnostic orchestration over family hooks)
  - `introspectDatabaseSchema()`: Orchestrates schema introspection using family-specific hooks
- **Error Factories**: Domain error factories (config errors, runtime errors, structured error envelopes)
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
import { defineConfig, type PrismaNextConfig } from '@prisma-next/core-control-plane/config-types';
import { validateConfig } from '@prisma-next/core-control-plane/config-validation';

// Define and normalize config
const config: PrismaNextConfig = defineConfig({
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

### Family Descriptors and Contexts

Control-plane family descriptors describe DB-connected capabilities for a target family (e.g., SQL) and are parameterized by a control-plane context type:

- `TargetFamilyContext<TSchemaIR>`: Pure type carrier for a family's schema IR type. It does not contain `schemaIR` as a runtime field; the schema IR is produced by introspection and passed as a separate value.
- Families extend this with their own control-plane state. For example, SQL adds a type metadata registry:

```typescript
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly types: SqlTypeMetadataRegistry;
};
```

- `FamilyDescriptor<TCtx extends TargetFamilyContext>` exposes:
  - `hook`, `convertOperationManifest`, `validateContractIR`, `stripMappings?`
  - Control-plane hooks for DB-connected commands:
    - `readMarker?`: Read contract markers from the database
    - `supportedTypeIds?`: Optional type coverage helper
    - `prepareControlContext?`: Build family-specific control-plane context from descriptors (e.g., SQL type metadata)
    - `introspectSchema?`: Introspect database schema and return `SchemaIROf<TCtx>`
    - `verifySchema?`: Compare contract IR against Schema IR and return `SchemaIssue[]`

Adapter, target, and extension descriptors are also parameterized by `TCtx` to keep family types consistent:

```typescript
export interface TargetDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> { /* … */ }
export interface AdapterDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> { /* … */ }
export interface ExtensionDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> { /* … */ }
```

### Emit Contract

```typescript
import { emitContract } from '@prisma-next/core-control-plane/emit-contract';

// Emit contract - returns strings (no file I/O)
const result = await emitContract({
  contractIR,
  targetFamily,
  operationRegistry,
  codecTypeImports,
  operationTypeImports,
  extensionIds,
});

// CLI layer writes strings to files
await writeFile('contract.json', result.contractJson);
await writeFile('contract.d.ts', result.contractDts);
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

