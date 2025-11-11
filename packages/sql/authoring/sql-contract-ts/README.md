# @prisma-next/sql-contract-ts

**Status:** Phase 2 - SQL-specific contract authoring surface composed with generic core

This package contains the SQL-specific TypeScript contract authoring surface for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: authoring
- **Plane**: migration

**Note**: SQL authoring may depend on SQL targets layer (e.g., `@prisma-next/sql-contract-types`) within the same domain.

## Overview

This package is part of the SQL family namespace (`packages/sql/authoring/sql-contract-ts`) and provides:
- SQL contract builder (`defineContract`) - TypeScript builder for creating SQL contracts programmatically
- SQL contract validation (`validateContract`) - Structural and logical validation for SQL contracts
- SQL contract JSON schema - JSON schema for validating contract structure

## Responsibilities

- **SQL Contract Builder**: Provides the `defineContract()` builder API for creating SQL contracts programmatically with type safety
- **SQL Contract Validation**: Implements SQL-specific contract validation (`validateContractStructure`, `validateContractLogic`, `validateContract`) and normalization
- **SQL Contract JSON Schema**: Provides JSON schema for validating contract structure in IDEs and tooling
- **Composition Layer**: Composes the target-agnostic builder core from `@prisma-next/contract-authoring` with SQL-specific types and validation logic

## Package Status

This package was created in Phase 1 and refactored in Phase 2. It now composes the target-agnostic builder core from `@prisma-next/contract-authoring` with SQL-specific types and validation logic.

## Architecture

- **Composes generic core**: Uses `@prisma-next/contract-authoring` for generic builder state management (`TableBuilder`, `ModelBuilder`, `ContractBuilder` base class)
- **SQL-specific types**: Provides SQL-specific contract types (`SqlContract`, `SqlStorage`, `SqlMappings`) from `@prisma-next/sql-target`
- **SQL-specific validation**: Implements SQL-specific contract validation (`validateContractStructure`, `validateContractLogic`, `validateContract`) and normalization (`normalizeContract`)
- **SQL-specific build()**: Implements SQL-specific `build()` method in `SqlContractBuilder` that constructs `SqlContract` instances with SQL-specific structure (uniques, indexes, foreignKeys arrays)

## Architecture

This package is part of the package layering architecture:
- **Location**: `packages/sql/authoring/sql-contract-ts` (SQL family namespace)
- **Ring**: SQL family namespace (can import from core, authoring, targets, and other SQL family packages)
- **Dependencies**: `@prisma-next/contract`, `@prisma-next/sql-target`, `arktype`, `ts-toolbelt`

## Exports

- `./contract-builder` - Contract builder API (`defineContract`, `ColumnBuilder`)
- `./contract` - Contract validation (`validateContract`, `computeMappings`)
- `./schema-sql` - SQL contract JSON schema (`data-contract-sql-v1.json`)

## Usage

### Building Contracts

```typescript
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();
```

### Validating Contracts

```typescript
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { Contract } from './contract.d';

// From JSON import
const contract = validateContract<Contract>(contractJson);

// Or with generic type (less type-safe)
const contract = validateContract<SqlContract<SqlStorage>>(contractJson);
```

## Dependencies

- **`@prisma-next/contract-authoring`** - Target-agnostic builder core (builder state types, builder classes, type helpers)
- **`@prisma-next/contract`** - Core contract types (`ContractBase`)
- **`@prisma-next/sql-contract`** - SQL contract types (`SqlContract`, `SqlStorage`, `SqlMappings`)
- **`arktype`** - Runtime validation
- **`ts-toolbelt`** - Type utilities

## Testing

Integration tests that depend on both `sql-contract-ts` and `sql-query` are located in `@prisma-next/integration-tests` to avoid cyclic dependencies.

## Migration Notes

- **Backward Compatibility**: `@prisma-next/sql-query` re-exports contract authoring functions for backward compatibility (will be removed in Slice 7)
- **Import Path**: New code should import directly from `@prisma-next/sql-contract-ts`
- **Phase 2 Complete**: The target-agnostic core has been extracted to `@prisma-next/contract-authoring`. This package composes the generic core with SQL-specific types.

## See Also

- `@prisma-next/contract-authoring` - Target-agnostic builder core that this package composes

