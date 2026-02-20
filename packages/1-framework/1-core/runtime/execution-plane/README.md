# @prisma-next/core-execution-plane

Execution/runtime plane descriptor and instance types for Prisma Next.

## Overview

This package provides TypeScript type definitions for execution/runtime-plane descriptors and instances. These types define the structure for runtime components (families, targets, adapters, drivers, extensions) and the descriptors-only execution stack that is instantiated by applications.

## Responsibilities

- **Runtime Instance Types**: Base interfaces for runtime plane instances (`RuntimeFamilyInstance`, `RuntimeTargetInstance`, `RuntimeAdapterInstance`, `RuntimeDriverInstance`, `RuntimeExtensionInstance`)
- **Runtime Descriptor Types**: Type definitions for runtime plane descriptors (`RuntimeFamilyDescriptor`, `RuntimeTargetDescriptor`, `RuntimeAdapterDescriptor`, `RuntimeDriverDescriptor`, `RuntimeExtensionDescriptor`)
- **Execution Stack Types**: Descriptors-only execution stack (`ExecutionStack`) and instantiated stack (`ExecutionStackInstance`)
- **Stack Instantiation**: Helper to instantiate a stack (`instantiateExecutionStack`). When stack has a driver descriptor, instance includes unbound `driver`; caller connects at boundary then passes driver to runtime.

## Dependencies

- **Depends on**:
  - `@prisma-next/contract/framework-components` - Framework component types (`AdapterDescriptor`, `AdapterInstance`, `DriverDescriptor`, `DriverInstance`, `ExtensionDescriptor`, `ExtensionInstance`, `FamilyDescriptor`, `FamilyInstance`, `TargetDescriptor`, `TargetInstance`)

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

### Execution Stack

Execution stacks group runtime descriptors and are instantiated explicitly. When the stack has a driver descriptor, `instantiateExecutionStack` includes an unbound driver; connect at the boundary then create runtime:

```typescript
import { createExecutionStack, instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';

const stack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

const stackInstance = instantiateExecutionStack(stack);
// stackInstance.driver is unbound; caller connects at boundary:
await stackInstance.driver!.connect(binding);
// then createRuntime({ stackInstance, context, driver: stackInstance.driver, ... })
```

## Package Location

This package is part of the **framework domain**, **core layer**, **runtime plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: runtime
- **Path**: `packages/1-framework/1-core/runtime/execution-plane`

## Related Documentation

- [ADR 152 — Execution Plane Descriptors and Instances](../../../../docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)
- [ADR 159 — Driver Terminology and Lifecycle](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md): Driver instantiation vs connection binding
- `.cursor/rules/multi-plane-packages.mdc`: Multi-plane package structure
- `packages/1-framework/1-core/migration/control-plane/README.md`: Control plane counterpart

