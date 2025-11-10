# @prisma-next/sql-contract-emitter

SQL emitter hook for Prisma Next.

## Overview

This package provides the SQL-specific emitter hook implementation for the Prisma Next emitter. It validates SQL contracts and generates TypeScript type definitions for SQL contracts. It's part of the targets ring and implements the `TargetFamilyHook` interface.

## Responsibilities

- **Contract Validation**: Validates SQL contract structure and types
  - `validateTypes()`: Validates type IDs against extensions and packs
  - `validateStructure()`: Validates SQL-specific contract structure (tables, models, constraints)

- **Type Generation**: Generates TypeScript type definitions for SQL contracts
  - `generateContractTypes()`: Generates `contract.d.ts` file content
  - `getCodecTypesImports()`: Determines required codec type imports from packs
  - `getOperationTypesImports()`: Determines required operation type imports from packs

## Dependencies

- **Depends on**: 
  - `@prisma-next/emitter` (contract IR and extension pack types)
  - `@prisma-next/sql-contract-types` (SQL contract type definitions)
- **Depended on by**: 
  - `@prisma-next/cli` (uses for contract emission)
  - `@prisma-next/integration-tests` (uses for contract emission tests)

## Architecture

```mermaid
flowchart TD
    subgraph "Tooling Ring"
        EMITTER[@prisma-next/emitter]
    end
    
    subgraph "Targets Ring"
        SQL_EMITTER[@prisma-next/sql-contract-emitter]
        CT[@prisma-next/sql-contract-types]
    end
    
    subgraph "Tooling Ring"
        CLI[@prisma-next/cli]
    end
    
    EMITTER --> SQL_EMITTER
    CT --> SQL_EMITTER
    SQL_EMITTER --> CLI
```

## Usage

### Using the SQL Emitter Hook

```typescript
import { emit } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';

const result = await emit(contractIR, options, sqlTargetFamilyHook);

// result.contractDts contains generated TypeScript types
// result.contractJson contains validated contract JSON
```

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
