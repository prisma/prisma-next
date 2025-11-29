# @prisma-next/sql-migrations

SQL migration planner and in-memory migration IR for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: tooling
- **Plane**: migration

## Overview

This package provides the SQL-family-owned migration planning logic and in-memory migration IR for Prisma Next. It's part of the SQL tooling layer (migration plane) and implements the core diffing algorithm that compares contracts and live database schemas to produce migration plans.

## Responsibilities

- **Migration Planning**: Plans migration operations from one contract to another, consulting live database schema
  - `planMigration()`: Core planning function that diffs contracts and schema IR
  - Supports `init` and `update` modes with configurable operation class policies
  - Emits additive operations (create table, add column, add constraints/indexes, extension operations)

- **Migration IR**: Defines in-memory representation of migration plans
  - `SqlMigrationPlan`: In-memory migration plan IR (distinct from serialized on-disk edge model)
  - `SqlMigrationOperation`: Union of all supported migration operations
  - `MigrationPolicy`: Policy governing allowed operation classes

- **Error Handling**: Family-scoped planning errors
  - `SqlMigrationPlanningError`: Structured error type for planning failures

## Dependencies

- **Depends on**:
  - `@prisma-next/sql-contract` (SQL contract types)
  - `@prisma-next/sql-schema-ir` (SQL schema IR types)
- **Depended on by**:
  - `@prisma-next/family-sql` (exposes `planMigration` on family instance)

## Architecture

```mermaid
flowchart TD
    subgraph "SQL Tooling Layer"
        SQL_MIGRATIONS[@prisma-next/sql-migrations]
    end

    subgraph "SQL Core Layer (Shared Plane)"
        SQL_CONTRACT[@prisma-next/sql-contract]
        SQL_SCHEMA_IR[@prisma-next/sql-schema-ir]
    end

    subgraph "SQL Family"
        SQL_FAMILY[@prisma-next/family-sql]
    end

    SQL_CONTRACT --> SQL_MIGRATIONS
    SQL_SCHEMA_IR --> SQL_MIGRATIONS
    SQL_MIGRATIONS --> SQL_FAMILY
```

## Usage

### Using the Migration Planner

```typescript
import { planMigration } from '@prisma-next/sql-migrations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

const plan = planMigration({
  fromContract: emptyContract,
  toContract: desiredContract,
  liveSchema: schemaIR,
  policy: {
    mode: 'init',
    allowedOperationClasses: ['additive', 'widening'],
  },
});

// plan.operations contains the planned migration operations
// plan.summary contains a human-readable summary
```

### Using via Family Instance

```typescript
import sql from '@prisma-next/family-sql/control';

const familyInstance = sql.create({
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

const plan = familyInstance.planMigration({
  fromContract: emptyContract,
  toContract: desiredContract,
  liveSchema: schemaIR,
  policy: {
    mode: 'init',
    allowedOperationClasses: ['additive', 'widening'],
  },
});
```

## Migration Operations

The planner emits the following additive operations:

- `createTable`: Creates a new table with all columns, primary key, uniques, indexes, and foreign keys
- `addColumn`: Adds a new column to an existing table
- `addPrimaryKey`: Adds a primary key constraint to an existing table
- `addUniqueConstraint`: Adds a unique constraint to an existing table
- `addForeignKey`: Adds a foreign key constraint to an existing table
- `addIndex`: Adds an index to an existing table
- `extensionOperation`: Extension-owned operations (e.g., `createExtension('pgvector')`)

## Planning Modes

- **`init` mode**: For `db init` command - additive-only, never performs destructive operations
- **`update` mode**: For `db update` command - supports expand/contract rules (future)

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [Migration System](../../../../docs/architecture docs/subsystems/7. Migration System.md)
- [ADR 028 - Migration Structure & Operations](../../../../docs/architecture docs/adrs/ADR 028 - Migration Structure & Operations.md)
- [Db Init Command](../../../../docs/Db-Init-Command.md)

