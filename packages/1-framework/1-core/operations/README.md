# @prisma-next/operations

Target-neutral operation registry for Prisma Next.

## Overview

This package provides a generic, target-neutral operation registry. It's part of the core ring and has no dependencies on target-specific packages.

## Responsibilities

- **Operation Registry**: Generic operation registry interface and implementation
  - `OperationRegistry<T>`: Generic interface for registering and iterating operations, parameterized by entry type. `register(name, descriptor)` keys each entry by an explicit method name supplied at the call site.
  - `createOperationRegistry<T>()`: Factory function to create operation registries
  - `OperationEntry`: Base entry type with `self` and `impl`
  - `OperationDescriptor<T>`: Alias for the entry shape used at registration sites
  - `OperationDescriptors<T>`: `Readonly<Record<string, OperationDescriptor<T>>>` — the natural shape contributors return, where the record key IS the method name
  - `ParamSpec`: Describes an operation parameter (`codecId`, `nullable`), used for both arguments and return values

## Dependencies


- **Depends on**: Nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/sql-operations` (extends with SQL-specific lowering specs)
  - `@prisma-next/sql-relational-core` (imports `ParamSpec` for AST and type definitions)
  - `@prisma-next/sql-runtime`, `@prisma-next/framework-components`, and other packages that build on the operation registry

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
  self: { codecId: 'pg/vector@1' },
  impl: () => ({ returnType: { codecId: 'pg/float8@1', nullable: false } }),
};

registry.register('cosineDistance', descriptor);
const entries = registry.entries(); // Record<string, OperationEntry>
```

### Using a Custom Entry Type

```typescript
import { createOperationRegistry, type OperationEntry } from '@prisma-next/operations';

interface MyEntry extends OperationEntry {
  readonly extra: string;
}

const registry = createOperationRegistry<MyEntry>();

registry.register('myMethod', {
  self: { codecId: 'pg/int4@1' },
  impl: () => undefined as never,
  extra: 'custom data',
});
```

## Package Location

This package is part of the **framework domain**, **core layer**, **shared plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: shared
- **Path**: `packages/1-framework/1-core/operations`

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
