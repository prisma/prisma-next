# @prisma-next/family-sql

SQL family CLI entry point for Prisma Next.

## Purpose

Provides the SQL family descriptor (`FamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Assembly helpers for operation registries and type imports

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

