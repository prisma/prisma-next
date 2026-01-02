# @prisma-next/core-execution-plane

Execution/runtime plane descriptor and instance types for Prisma Next.

## Overview

This package provides TypeScript type definitions for execution/runtime-plane descriptors and instances. These types define the structure for runtime components (families, targets, adapters, drivers, extensions) that are used during query execution.

## Responsibilities

- **Runtime Instance Types**: Base interfaces for runtime plane instances (`RuntimeFamilyInstance`, `RuntimeTargetInstance`, `RuntimeAdapterInstance`, `RuntimeDriverInstance`, `RuntimeExtensionInstance`)
- **Runtime Descriptor Types**: Type definitions for runtime plane descriptors (`RuntimeFamilyDescriptor`, `RuntimeTargetDescriptor`, `RuntimeAdapterDescriptor`, `RuntimeDriverDescriptor`, `RuntimeExtensionDescriptor`)

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` - Operation manifest types (`OperationManifest`, `ReturnSpecManifest`)

- **Depended on by**:
  - Runtime plane packages (adapters, drivers, targets) - Use descriptor and instance types
  - SQL family runtime - Uses runtime family descriptor types

## Architecture

```mermaid
flowchart TD
    subgraph "Core Layer - Runtime Plane"
        CEP[@prisma-next/core-execution-plane]
    end

    subgraph "Runtime Plane Packages"
        ADAPTER[Adapters]
        DRIVER[Drivers]
        TARGET[Targets]
        FAMILY[SQL Family Runtime]
    end

    ADAPTER -->|uses| CEP
    DRIVER -->|uses| CEP
    TARGET -->|uses| CEP
    FAMILY -->|uses| CEP
```

## Usage

### Runtime Descriptors

Runtime descriptors provide factory methods to create runtime instances:

```typescript
import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';

// Adapter descriptor provides create() method
const adapterDescriptor: RuntimeAdapterDescriptor<'sql', 'postgres', SqlAdapter> = {
  kind: 'adapter',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: adapterManifest,
  create(): SqlAdapter {
    return createPostgresAdapter();
  },
};
```

### Runtime Instances

Runtime instances are created from descriptors and used during query execution:

```typescript
import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';

// Adapter instance used at runtime
const adapter: RuntimeAdapterInstance<'sql', 'postgres'> = adapterDescriptor.create();
```

## Package Location

This package is part of the **framework domain**, **core layer**, **runtime plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: runtime
- **Path**: `packages/1-framework/1-core/runtime/execution-plane`

## Related Documentation

- `docs/architecture docs/adrs/ADR 152 - Runtime Plane Descriptors and Instances.md`: Complete ADR specification
- `.cursor/rules/multi-plane-packages.mdc`: Multi-plane package structure
- `packages/1-framework/1-core/migration/control-plane/README.md`: Control plane counterpart

