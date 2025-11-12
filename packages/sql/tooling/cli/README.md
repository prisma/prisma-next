# @prisma-next/family-sql

SQL family CLI entry point for Prisma Next.

## Purpose

Provides the SQL family descriptor (`FamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Operation manifest conversion (`convertOperationManifest`)
- Contract validation and normalization (`validateContractIR`, `stripMappings`)

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `FamilyDescriptor` for use in CLI configuration files
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`
- **Operation Manifest Conversion**: Provides `convertOperationManifest` to convert `OperationManifest` to `SqlOperationSignature` (adds lowering spec)
- **Contract Validation**: Provides `validateContractIR` to validate and normalize contracts, returning ContractIR without mappings
- **Mappings Stripping**: Provides `stripMappings` to remove runtime-only mappings from contracts before emission
- **CLI Entry Point**: Serves as the CLI entry point for the SQL family, enabling the CLI to select the family hook and process SQL family descriptors

## Usage

```typescript
import sql from '@prisma-next/family-sql/cli';

// sql is a FamilyDescriptor with:
// - kind: 'family'
// - id: 'sql'
// - hook: TargetFamilyHook
// - convertOperationManifest: (manifest) => OperationSignature
// - validateContractIR: (contractJson) => ContractIR (without mappings)
// - stripMappings?: (contract) => contract (removes mappings)
```

## Architecture

This package is the CLI entry point for the SQL family. It composes:
- `@prisma-next/sql-contract-emitter` - Provides the SQL family hook
- `@prisma-next/sql-operations` - SQL operation signature types

The framework CLI uses this descriptor to:
1. Select the family hook for emit
2. Convert operation manifests to signatures (via `convertOperationManifest`)
3. Validate and normalize contracts before emission (via `validateContractIR`)
4. Strip runtime-only mappings from contracts (via `stripMappings`)

The framework CLI handles the generic looping over descriptors and delegates family-specific conversion to `convertOperationManifest`.

## Dependencies

- **`@prisma-next/cli`**: CLI descriptor types (`FamilyDescriptor`, `OperationManifest`)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)
- **`@prisma-next/sql-contract`**: SQL contract types (`SqlContract`, `SqlStorage`)
- **`@prisma-next/sql-operations`**: SQL operation signature types (`SqlOperationSignature`)

**Dependents:**
- CLI configuration files import this package to register the SQL family

