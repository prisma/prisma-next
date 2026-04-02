# @prisma-next/operations

Target-neutral operation registry for Prisma Next.

## Overview

This package provides a generic, target-neutral operation registry. It's part of the core ring and has no dependencies on target-specific packages.

## Responsibilities

- **Operation Registry**: Generic operation registry interface and implementation
  - `OperationRegistry<T>`: Generic interface for registering and iterating operations, parameterized by entry type
  - `createOperationRegistry<T>()`: Factory function to create operation registries
  - `OperationEntry`: Base entry type with `args` and `returns`
  - `OperationDescriptor<T>`: Entry plus a `method` name, used for registration
  - `OperationArg`: Describes an operation argument (`codecId`, `nullable`)
  - `OperationReturn`: Describes an operation return value (`codecId`, `nullable`)

## Dependencies

- **Depends on**: Nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/sql-operations` (extends with SQL-specific lowering specs)
  - `@prisma-next/sql-relational-core` (uses for capability checking)
  - `@prisma-next/runtime` (uses for operation registry creation)

## Architecture

```mermaid
flowchart TD
    subgraph "Core Ring"
        OPS[@prisma-next/operations]
    end

    subgraph "Targets Ring"
        SQL_OPS[@prisma-next/sql-operations]
    end

    subgraph "Lanes Ring"
        REL_CORE[@prisma-next/sql-relational-core]
    end

    subgraph "Runtime Ring"
        RT[@prisma-next/runtime]
    end

    OPS --> SQL_OPS
    OPS --> REL_CORE
    OPS --> RT
```

## Usage

### Creating an Operation Registry

```typescript
import { createOperationRegistry, type OperationDescriptor } from '@prisma-next/operations';

const registry = createOperationRegistry();

const descriptor: OperationDescriptor = {
  method: 'cosineDistance',
  args: [{ codecId: 'pg/vector@1', nullable: false }],
  returns: { codecId: 'pg/float8@1', nullable: false },
};

registry.register(descriptor);
const entries = registry.entries(); // Record<string, OperationEntry>
```

### Using a Custom Entry Type

```typescript
import { createOperationRegistry, type OperationEntry, type OperationDescriptor } from '@prisma-next/operations';

interface MyEntry extends OperationEntry {
  readonly extra: string;
}

const registry = createOperationRegistry<MyEntry>();

registry.register({
  method: 'myMethod',
  args: [],
  returns: { codecId: 'pg/int4@1', nullable: false },
  extra: 'custom data',
});
```

## Package Location

This package is part of the **framework domain**, **core layer**, **shared plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: shared
- **Path**: `packages/1-framework/1-core/shared/operations`

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
