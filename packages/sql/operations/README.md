# @prisma-next/sql-operations

SQL-specific operation definitions and assembly for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: core
- **Plane**: shared

## Overview

This package provides SQL-specific operation logic, including operation assembly from operation manifests and SQL-specific lowering specifications. It lives in the shared plane to allow both migration-plane (emitter/CLI) and runtime-plane (lanes/runtime) packages to import operation types without violating plane boundaries. The package contains only types and pure assembly functions (no pack I/O); pack reading/resolution is handled by the emitter/CLI.

## Responsibilities

- **Operation Assembly**: Assembles operation registries from operation manifests
  - `assembleOperationRegistry()`: Creates operation registry from plain manifest objects
  - `OperationManifestLike`: Interface for operation manifest objects
  - `OperationSignature`: SQL-specific operation signature (extends core with lowering specs)
  - `LoweringSpec`: SQL-specific lowering specification (strategy, template)

- **Manifest Validation**: Optional Arktype validators for operation manifests
  - `validateOperationManifest()`: Validates a single operation manifest
  - `validateOperationManifests()`: Validates an array of operation manifests

- **SQL Lowering**: Defines how operations are lowered to SQL
  - `LoweringStrategy`: 'infix' or 'function' lowering strategies
  - `LoweringSpec`: Target family, strategy, and template for SQL lowering

## Dependencies

- **Depends on**:
  - `@prisma-next/operations` (core operation registry types)
  - `arktype` (for manifest validation)
- **Depended on by**:
  - `@prisma-next/sql-relational-core` (uses for operation execution)
  - `@prisma-next/sql-runtime` (uses for operation signature types)
  - `@prisma-next/emitter` (uses for pack-based assembly via `assembleOperationRegistryFromPacks`)

## Architecture

```mermaid
flowchart TD
    subgraph "Core Ring (Shared Plane)"
        OPS[@prisma-next/operations]
        SQL_OPS[@prisma-next/sql-operations]
    end

    subgraph "Tooling Ring (Migration Plane)"
        EMITTER[@prisma-next/emitter]
    end

    subgraph "Lanes Ring (Runtime Plane)"
        REL_CORE[@prisma-next/sql-relational-core]
    end

    subgraph "Runtime Ring (Runtime Plane)"
        SQL_RUNTIME[@prisma-next/sql-runtime]
    end

    OPS --> SQL_OPS
    EMITTER --> SQL_OPS
    SQL_OPS --> REL_CORE
    SQL_OPS --> SQL_RUNTIME
```

## Usage

### Assembling Operations from Manifests

```typescript
import {
  assembleOperationRegistry,
  type OperationManifestLike,
} from '@prisma-next/sql-operations';

const manifests: OperationManifestLike[] = [
  {
    for: 'pgvector/vector@1',
    method: 'cosineDistance',
    args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
    returns: { kind: 'builtin', type: 'number' },
    lowering: {
      strategy: 'infix',
      template: '${self} <=> ${arg0}',
    },
  },
];

const registry = assembleOperationRegistry(manifests);
```

### Assembling Operations from Extension Packs (Emitter/CLI)

For tooling code that works with extension packs, use the emitter's `assembleOperationRegistryFromPacks` function:

```typescript
import { assembleOperationRegistryFromPacks } from '@prisma-next/emitter';
import type { ExtensionPack } from '@prisma-next/emitter';

const packs: ExtensionPack[] = [/* ... */];
const registry = assembleOperationRegistryFromPacks(packs);
```

This function extracts operation manifests from packs, validates them, and calls the shared `assembleOperationRegistry` function.

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
