# @prisma-next/family-sql

SQL family CLI entry point for Prisma Next.

## Purpose

Provides the SQL family descriptor (`FamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Assembly helpers for operation registries and type imports
- Contract validation and normalization (`validateContractIR`, `stripMappings`)

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `FamilyDescriptor` for use in CLI configuration files
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`
- **Assembly Helper Integration**: Integrates assembly helpers from `@prisma-next/sql-tooling-assembly` for processing descriptors
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
// - assembleOperationRegistry: (descriptors) => OperationRegistry
// - extractCodecTypeImports: (descriptors) => TypesImportSpec[]
// - extractOperationTypeImports: (descriptors) => TypesImportSpec[]
// - validateContractIR: (contractJson) => ContractIR (without mappings)
// - stripMappings?: (contract) => contract (removes mappings)
```

## Architecture

This package is the CLI entry point for the SQL family. It composes:
- `@prisma-next/sql-contract-emitter` - Provides the SQL family hook
- `@prisma-next/sql-tooling-assembly` - Provides assembly helpers

The CLI uses this descriptor to:
1. Select the family hook for emit
2. Assemble operation registries from adapter/target/extension descriptors
3. Extract codec and operation type imports from descriptors
4. Validate and normalize contracts before emission
5. Strip runtime-only mappings from contracts

## Dependencies

- **`@prisma-next/cli`**: CLI descriptor types (`FamilyDescriptor`)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-tooling-assembly`**: Assembly helpers for processing descriptors
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)

**Dependents:**
- CLI configuration files import this package to register the SQL family

