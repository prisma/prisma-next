# @prisma-next/operations

Target-neutral operation registry and capability helpers for Prisma Next.

## Overview

This package provides target-neutral operation registry types and capability checking utilities. It's part of the core ring and has no dependencies on target-specific packages.

## Responsibilities

- **Operation Registry**: Core operation registry interface and implementation
  - `OperationRegistry`: Interface for registering and querying operations
  - `createOperationRegistry()`: Factory function to create operation registries
  - `OperationSignature`: Core operation signature type (target-neutral)
  - `ArgSpec`, `ReturnSpec`: Type definitions for operation arguments and return values

- **Capability Checking**: Target-neutral capability validation
  - `hasAllCapabilities()`: Checks if all required capabilities are present in a contract

## Dependencies

- **Depends on**: None (core ring package)
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
import { createOperationRegistry, type OperationSignature } from '@prisma-next/operations';

const registry = createOperationRegistry();

const signature: OperationSignature = {
  forTypeId: 'pg/vector@1',
  method: 'cosineDistance',
  args: [{ kind: 'typeId', type: 'pg/vector@1' }],
  returns: { kind: 'builtin', type: 'number' },
};

registry.register(signature);
const operations = registry.byType('pg/vector@1');
```

### Checking Capabilities

```typescript
import { hasAllCapabilities } from '@prisma-next/operations';

const contractCapabilities = {
  pgvector: {
    'index.ivfflat': true,
  },
};

const hasCapability = hasAllCapabilities(
  ['pgvector.index.ivfflat'],
  contractCapabilities,
);
```

## Related Documentation

- [Package Layering](../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
