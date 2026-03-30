# @prisma-next/sql-operations

SQL-specific operation types and registry helpers for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: core
- **Plane**: shared

## Overview

This package provides SQL-specific operation types and typed registry helpers. It lives in the shared plane to allow both migration-plane (emitter/CLI) and runtime-plane (lanes/runtime) packages to import operation types without violating plane boundaries. The package contains only types and pure helpers (no pack I/O, no manifest assembly); manifest assembly is handled by the CLI/tooling layer.

## Responsibilities

- **SQL Operation Types**: SQL-specific operation signature types
  - `SqlOperationSignature`: SQL-specific operation signature (extends core `OperationSignature` with lowering specs)
  - `SqlLoweringSpec`: SQL-specific lowering specification (target family, strategy, template)
  - `SqlOperationRegistry`: Typed registry alias for SQL operations

- **Registry Helpers**: Typed helpers for creating and using SQL operation registries
  - `createSqlOperationRegistry()`: Creates a typed SQL operation registry
  - `register()`: Typed wrapper for registering operations in a registry

## Dependencies

- **Depends on**:
  - `@prisma-next/operations` (core operation registry types)
- **Depended on by**:
  - `@prisma-next/sql-relational-core` (uses for operation execution)
  - `@prisma-next/sql-runtime` (uses for operation signature types)
  - `@prisma-next/cli` (uses types when assembling registries from packs)

## Architecture

```mermaid
flowchart TD
    subgraph "Core Ring (Shared Plane)"
        OPS[@prisma-next/operations]
        SQL_OPS[@prisma-next/sql-operations]
    end

    subgraph "Tooling Ring (Migration Plane)"
        CLI[@prisma-next/cli]
    end

    subgraph "Lanes Ring (Runtime Plane)"
        REL_CORE[@prisma-next/sql-relational-core]
    end

    subgraph "Runtime Ring (Runtime Plane)"
        SQL_RUNTIME[@prisma-next/sql-runtime]
    end

    OPS --> SQL_OPS
    CLI --> SQL_OPS
    SQL_OPS --> REL_CORE
    SQL_OPS --> SQL_RUNTIME
```

## Usage

### Creating and Using SQL Operation Registries

```typescript
import {
  createSqlOperationRegistry,
  register,
  type SqlOperationSignature,
} from '@prisma-next/sql-operations';

const registry = createSqlOperationRegistry();

const signature: SqlOperationSignature = {
  forTypeId: 'pgvector/vector@1',
  method: 'cosineDistance',
  args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
  returns: { kind: 'builtin', type: 'number' },
  lowering: {
    targetFamily: 'sql',
    strategy: 'infix',
    template: '{{self}} <=> {{arg0}}',
  },
};

register(registry, signature);

const operations = registry.byType('pgvector/vector@1');
```

### Assembling Operations from Extension Packs (CLI/Tooling)

For tooling code that works with extension packs, manifest assembly happens in the CLI layer. See `@prisma-next/cli` for pack assembly utilities.

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
