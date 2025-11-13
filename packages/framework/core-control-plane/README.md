# @prisma-next/control-plane

Control plane types and executor for Prisma Next database operations.

## Overview

This package provides the control plane abstraction for Prisma Next, separating control plane operations (database verification, contract management) from the CLI executable. The control plane can be used programmatically without requiring CLI tooling.

## Responsibilities

- **Control Plane Types**: Defines types for control plane operations (`ControlPlaneDriver`, descriptor types)
- **Control Executor**: Provides `ControlExecutor` class for database verification operations
- **Type Definitions**: Exports descriptor types (`FamilyDescriptor`, `TargetDescriptor`, `AdapterDescriptor`, `DriverDescriptor`, `ExtensionDescriptor`)

## Package Contents

- **Types**: Control plane type definitions (`ControlPlaneDriver`, descriptor interfaces)
- **Executor**: `ControlExecutor` class for database verification

## Usage

### Control Plane Types

Import control plane types:

```typescript
import type {
  ControlPlaneDriver,
  DriverDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
  AdapterDescriptor,
  ExtensionDescriptor,
} from '@prisma-next/control-plane/types';
```

### Control Executor

Use `ControlExecutor` for database verification:

```typescript
import { ControlExecutor } from '@prisma-next/control-plane/executor';
import type { VerifyDatabaseResult } from '@prisma-next/control-plane/executor';

const executor = new ControlExecutor({
  driver,
  familyVerify: family.verify,
  adapter,
  target,
  extensions,
  contractIR,
});

const result: VerifyDatabaseResult = await executor.verifyAgainst(
  targetId,
  startTime,
  configPath,
  contractPath,
);

await executor.close();
```

## Architecture

- **Domain**: `framework`
- **Layer**: `core`
- **Plane**: `shared`

This package is in the shared plane, allowing both migration-plane (CLI) and runtime-plane packages to import control plane types when needed.

## Dependencies

- `@prisma-next/contract` - For `ContractMarkerRecord` type
- `@prisma-next/emitter` - For `TargetFamilyHook` type
- `@prisma-next/operations` - For `OperationSignature` type
- `@prisma-next/cli` - For `ExtensionPackManifest` and `OperationManifest` types

## Related Documentation

- `docs/briefs/Control-Plane-Executor.md`: Control plane executor design
- `docs/Architecture Overview.md`: Architecture overview

