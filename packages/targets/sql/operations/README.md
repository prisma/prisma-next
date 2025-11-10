# @prisma-next/sql-operations

SQL-specific operation definitions and assembly for Prisma Next.

## Overview

This package provides SQL-specific operation logic, including operation assembly from extension packs and SQL-specific lowering specifications. It's part of the targets ring and extends the core operations package with SQL-specific functionality.

## Responsibilities

- **Operation Assembly**: Assembles operation registries from extension pack manifests
  - `assembleOperationRegistry()`: Creates operation registry from extension packs
  - `OperationSignature`: SQL-specific operation signature (extends core with lowering specs)
  - `LoweringSpec`: SQL-specific lowering specification (strategy, template)

- **SQL Lowering**: Defines how operations are lowered to SQL
  - `LoweringStrategy`: 'infix' or 'function' lowering strategies
  - `LoweringSpec`: Target family, strategy, and template for SQL lowering

## Dependencies

- **Depends on**: 
  - `@prisma-next/operations` (core operation registry types)
  - `@prisma-next/emitter` (extension pack types)
- **Depended on by**: 
  - `@prisma-next/sql-relational-core` (uses for operation execution)
  - `@prisma-next/sql-target` (re-exports for backward compatibility)

## Architecture

```mermaid
flowchart TD
    subgraph "Core Ring"
        OPS[@prisma-next/operations]
    end
    
    subgraph "Targets Ring"
        SQL_OPS[@prisma-next/sql-operations]
        EMITTER[@prisma-next/emitter]
    end
    
    subgraph "Lanes Ring"
        REL_CORE[@prisma-next/sql-relational-core]
    end
    
    OPS --> SQL_OPS
    EMITTER --> SQL_OPS
    SQL_OPS --> REL_CORE
```

## Usage

### Assembling Operations from Extension Packs

```typescript
import { assembleOperationRegistry } from '@prisma-next/sql-operations';
import type { ExtensionPack } from '@prisma-next/emitter';

const packs: ExtensionPack[] = [
  {
    manifest: {
      id: 'pgvector',
      version: '1.0.0',
      operations: [
        {
          for: 'pgvector/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'param' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            strategy: 'infix',
            template: '${self} <=> ${arg0}',
          },
        },
      ],
    },
    path: '/path/to/pack',
  },
];

const registry = assembleOperationRegistry(packs);
```

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
