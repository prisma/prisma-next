# @prisma-next/sql-contract-types

SQL-specific contract types for Prisma Next.

## Overview

This package provides SQL-specific contract type definitions, including storage types, model definitions, and mappings. It's part of the targets ring and defines the SQL contract structure.

## Responsibilities

- **Contract Types**: SQL-specific contract type definitions
  - `SqlContract`: SQL contract type with storage, models, relations, and mappings
  - `SqlStorage`: SQL storage structure (tables, columns, constraints)
  - `SqlMappings`: Model-to-table and field-to-column mappings
  - `ModelDefinition`, `ModelField`: Model structure definitions
  - `StorageTable`, `StorageColumn`: Storage structure definitions

## Dependencies

- **Depends on**: None (pure type definitions)
- **Depended on by**: 
  - `@prisma-next/sql-contract-ts` (uses for contract authoring)
  - `@prisma-next/sql-contract-emitter` (uses for contract validation)
  - `@prisma-next/sql-relational-core` (uses for schema building)
  - `@prisma-next/sql-target` (re-exports for backward compatibility)

## Architecture

```mermaid
flowchart TD
    subgraph "Targets Ring"
        CT[@prisma-next/sql-contract-types]
        EMITTER[@prisma-next/sql-contract-emitter]
    end
    
    subgraph "Authoring Ring"
        SQL_TS[@prisma-next/sql-contract-ts]
    end
    
    subgraph "Lanes Ring"
        REL_CORE[@prisma-next/sql-relational-core]
    end
    
    CT --> SQL_TS
    CT --> EMITTER
    CT --> REL_CORE
```

## Usage

### Defining SQL Contracts

```typescript
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';

const storage: SqlStorage = {
  tables: {
    user: {
      columns: {
        id: { type: 'pg/int4@1', nullable: false },
        email: { type: 'pg/text@1', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:...',
  storage,
  models: {},
  relations: {},
  mappings: {},
};
```

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
