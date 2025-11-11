# @prisma-next/family-sql

SQL family CLI entry point for Prisma Next.

## Purpose

Provides the SQL family descriptor (`FamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Assembly helpers for operation registries and type imports

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `FamilyDescriptor` for use in CLI configuration files
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`
- **Assembly Helper Integration**: Integrates assembly helpers from `@prisma-next/sql-tooling-assembly` for processing descriptors
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
```

## Architecture

This package is the CLI entry point for the SQL family. It composes:
- `@prisma-next/sql-contract-emitter` - Provides the SQL family hook
- `@prisma-next/sql-tooling-assembly` - Provides assembly helpers

The CLI uses this descriptor to:
1. Select the family hook for emit
2. Assemble operation registries from adapter/target/extension descriptors
3. Extract codec and operation type imports from descriptors

## Dependencies

- **`@prisma-next/cli`**: CLI descriptor types (`FamilyDescriptor`)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-tooling-assembly`**: Assembly helpers for processing descriptors

**Dependents:**
- CLI configuration files import this package to register the SQL family

