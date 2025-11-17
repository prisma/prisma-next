# @prisma-next/sql-schema-ir

SQL Schema Intermediate Representation (IR) types for Prisma Next.

## Overview

This package defines the core types for the SQL Schema IR, a target-agnostic representation of SQL database schemas. This IR is used for schema verification, migration planning, and other tooling operations within the SQL family.

## Purpose

- **Provide a canonical in-memory representation** of SQL schemas that is independent of specific database implementations
- **Decouple schema introspection from verification logic** - adapters produce `SqlSchemaIR`, verification logic consumes it
- **Enable extensible metadata** via annotations for targets and extension packs
- **Support future migration planning** by providing a structured representation of schema differences

## Types

### Core Types

- **`SqlSchemaIR`** - Complete database schema representation with tables, extensions, and annotations
- **`SqlTableIR`** - Table representation with columns, constraints, indexes, and annotations
- **`SqlColumnIR`** - Column representation with `typeId` (codec ID), `nativeType` (DB-specific type), nullability, and annotations
- **`SqlForeignKeyIR`** - Foreign key constraint representation
- **`SqlUniqueIR`** - Unique constraint representation
- **`SqlIndexIR`** - Index representation
- **`SqlAnnotations`** - Namespaced extensibility metadata (e.g., `{ pg: { version: '15' } }`)

### Key Design Decisions

1. **`typeId` vs `nativeType`**: Columns include both a codec ID (`typeId`, e.g., `'pg/int4@1'`) and an optional native database type (`nativeType`, e.g., `'integer'`). The codec ID provides target-agnostic type information, while `nativeType` enables verification of extension-specific types (e.g., `'vector'` for pgvector).

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
          typeId: 'pg/int4@1',
          nativeType: 'integer',
          nullable: false,
        },
        email: {
          name: 'email',
          typeId: 'pg/text@1',
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
import { introspectPostgresSchema } from '@prisma-next/adapter-postgres/introspect';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

const schemaIR: SqlSchemaIR = await introspectPostgresSchema(driver, codecRegistry, contract);
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

### Dependencies

- `@prisma-next/contract` - For `ContractIR` type (used in `SqlContractIR`)

### Consumers

- **Migration Plane**:
  - `@prisma-next/core-control-plane` - Core verification logic
  - `@prisma-next/adapter-postgres` - Postgres introspection
  - `@prisma-next/extension-pgvector` - Extension verification hooks

- **Runtime Plane** (future):
  - Migration planning logic
  - Schema diff utilities

## Related Documentation

- `docs/briefs/11-schema-ir.md` - Schema IR project brief
- `docs/briefs/SQL Schema IR and Verification.md` - Detailed design document
- `packages/framework/core-control-plane/src/actions/verify-database-schema.ts` - Core verification action
- `packages/targets/postgres-adapter/src/exports/introspect.ts` - Postgres introspection implementation

