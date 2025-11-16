# @prisma-next/family-sql

SQL family descriptor for control plane and runtime.

## Purpose

Provides the SQL family descriptor (`FamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Operation manifest conversion (`convertOperationManifest`)
- Contract validation and normalization (`validateContractIR`, `stripMappings`)
- Schema verification (`verifySchema`, `introspectSchema`, `readMarker`)

## Structure

This package uses a multi-plane structure with separate entrypoints:

- **`./cli`** - Control plane (migration) entrypoint
  - Exports `FamilyDescriptor` for use in CLI configuration files
  - Provides family hook, operation conversion, and contract validation
  - Used by the framework CLI for emit and verify commands

- **`./runtime`** - Execution plane (runtime) entrypoint
  - Placeholder for future runtime family hooks
  - Will be implemented when runtime family integration is needed

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `FamilyDescriptor` for use in CLI configuration files
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`
- **Operation Manifest Conversion**: Provides `convertOperationManifest` to convert `OperationManifest` to `SqlOperationSignature` (adds lowering spec)
- **Contract Validation**: Provides `validateContractIR` to validate and normalize contracts, returning ContractIR without mappings
- **Mappings Stripping**: Provides `stripMappings` to remove runtime-only mappings from contracts before emission
- **Schema Verification**: Provides `verifySchema`, `introspectSchema`, and `readMarker` for database schema verification

## Usage

### Control Plane (CLI)

```typescript
import sql from '@prisma-next/family-sql/cli';

// sql is a FamilyDescriptor with:
// - kind: 'family'
// - id: 'sql'
// - hook: TargetFamilyHook
// - convertOperationManifest: (manifest) => OperationSignature
// - validateContractIR: (contractJson) => ContractIR (without mappings)
// - stripMappings?: (contract) => contract (removes mappings)
// - verify: { verifySchema, introspectSchema, readMarker, ... }
```

### Runtime (Future)

```typescript
// Placeholder for future runtime family hooks
import sqlRuntime from '@prisma-next/family-sql/runtime';
```

## Architecture

This package is structured as a multi-plane package:

- **`src/exports/cli.ts`**: Control plane entrypoint (migration plane)
- **`src/exports/runtime.ts`**: Execution plane entrypoint (runtime plane, placeholder)
- **`src/verify.ts`**: Shared verification logic used by control plane

The package follows the multi-plane entrypoint pattern established by adapter packages like `@prisma-next/adapter-postgres`, allowing it to serve both migration and runtime planes while maintaining strict plane boundaries.

## Dependencies

- **`@prisma-next/cli`**: CLI descriptor types (`FamilyDescriptor`, `OperationManifest`)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)
- **`@prisma-next/sql-contract`**: SQL contract types (`SqlContract`, `SqlStorage`)
- **`@prisma-next/sql-operations`**: SQL operation signature types (`SqlOperationSignature`)
- **`@prisma-next/sql-schema-ir`**: SQL schema IR types (`SqlSchemaIR`)
- **`@prisma-next/core-control-plane`**: Control plane types and verification utilities

**Dependents:**
- CLI configuration files import this package to register the SQL family

