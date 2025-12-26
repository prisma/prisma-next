# @prisma-next/sql-schema-ir

SQL Schema Intermediate Representation (IR) types for Prisma Next.

## Overview

This package defines the core types for the SQL Schema IR, a target-agnostic representation of SQL database schemas. This IR is used for schema verification, migration planning, and other tooling operations within the SQL family.

## Purpose

- **Provide a canonical in-memory representation** of SQL schemas that is independent of specific database implementations
- **Decouple schema introspection from verification logic** - adapters produce `SqlSchemaIR`, verification logic consumes it
- **Enable extensible metadata** via annotations for targets and extension packs
- **Support future migration planning** by providing a structured representation of schema differences

## Responsibilities

- **Type Definitions**: Provides core types for SQL Schema IR (`SqlSchemaIR`, `SqlTableIR`, `SqlColumnIR`, etc.)
- **Shared Plane Package**: Located in the shared plane, making it accessible to both migration-plane and runtime-plane packages
- **Extensibility**: Supports annotations for targets and extension packs to attach metadata without modifying core IR structure
- **Type Safety**: Provides TypeScript types for schema representation with proper nullability and constraint modeling

## Dependencies

- **`@prisma-next/contract`**: For `ContractIR` type (used in `SqlContractIR`)

**Dependents:**
- **Migration Plane**:
  - `@prisma-next/core-control-plane` - Core verification logic
  - `@prisma-next/adapter-postgres` - Postgres introspection
  - `@prisma-next/extension-pgvector` - Extension verification hooks
- **Runtime Plane** (future):
  - Migration planning logic
  - Schema diff utilities

## Types

### Core Types

- **`SqlSchemaIR`** - Complete database schema representation with tables, extensions, and annotations
- **`SqlTableIR`** - Table representation with columns, constraints, indexes, and annotations
- **`SqlColumnIR`** - Column representation with `nativeType` (DB-specific type), nullability, and annotations
- **`SqlForeignKeyIR`** - Foreign key constraint representation
- **`SqlUniqueIR`** - Unique constraint representation
- **`SqlIndexIR`** - Index representation
- **`SqlAnnotations`** - Namespaced extensibility metadata (e.g., `{ pg: { version: '15' } }`)

### Key Design Decisions

1. **Native type primary**: Columns capture the database-native type (`nativeType`, e.g., `'integer'`, `'vector'`). Codec IDs now live exclusively in the contract—schema IR focuses solely on what exists in the database. This keeps schema verification centered on actual storage, while contract metadata handles codec-level concerns.

2. **Annotations**: All IR types support optional `annotations` for extensibility. This allows targets and extensions to attach metadata without modifying the core IR structure.

3. **Shared Plane**: This package is in the **shared plane**, meaning it can be safely imported by both migration-plane (verification, migration planning) and runtime-plane code.

## Usage

### Basic Usage

```typescript
import type { SqlSchemaIR, SqlTableIR, SqlColumnIR } from '@prisma-next/sql-schema-ir/types';

const schemaIR: SqlSchemaIR = {
  tables: {
    user: {
      name: 'user',
      columns: {
        id: {
          name: 'id',
          nativeType: 'integer',
          nullable: false,
        },
        email: {
          name: 'email',
          nativeType: 'text',
          nullable: false,
        },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [{ columns: ['email'] }],
      indexes: [],
    },
  },
  extensions: ['vector'],
  annotations: {
    pg: {
      version: '15',
    },
  },
};
```

### Schema Introspection

Adapters produce `SqlSchemaIR` by querying database catalogs:

```typescript
// In Postgres adapter
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

const controlAdapter = postgresAdapter.createControlInstance();
const schemaIR: SqlSchemaIR = await controlAdapter.introspect(driver, contract);
```

### Schema Verification

The core control plane compares contracts against `SqlSchemaIR`:

```typescript
// In core-control-plane
import { verifyDatabaseSchema } from '@prisma-next/core-control-plane/verify-database-schema';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

const result = await verifyDatabaseSchema({
  driver,
  contractIR,
  schemaIR, // Produced by family.introspectSchema
  family,
  target,
  adapter,
  extensions,
  strict: false,
});
```

## Architecture

### Package Location

- **Domain**: `sql`
- **Layer**: `core`
- **Plane**: `shared`

This package sits at the core layer in the shared plane, making it accessible to both migration-plane (authoring, tooling, targets) and runtime-plane (lanes, runtime, adapters) packages.


## Related Documentation

- `docs/briefs/11-schema-ir.md` - Schema IR project brief
- `docs/briefs/SQL Schema IR and Verification.md` - Detailed design document
- `packages/1-framework/1-core/migration/control-plane/src/verify-database-schema.ts` - Core verification action
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts` - Postgres introspection entrypoint

