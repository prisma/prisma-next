# @prisma-next/core-control-plane

Control-plane migration and emission primitives for Prisma Next.

## Overview

This package provides control-plane building blocks consumed by CLI/tooling and target-family packages:

- migration/result interfaces and control-plane component types
- stack composition helper (`createControlPlaneStack`)
- schema-view interfaces
- contract emission/hash helpers
- structured error utilities used by CLI output mapping

## Responsibilities

- **Control stack and component contracts**: stack composition and migration-facing descriptor/instance types
- **Migration SPI**: planner/runner/capability interfaces that thread family/target IDs through control flows
- **Emission helpers**: canonicalization/hash utilities and emit result shaping
- **Structured errors**: CLI/runtime envelope-compatible error factories

## Usage

Config authoring types and validation now live in `@prisma-next/config`:

- `@prisma-next/config/config-types`
- `@prisma-next/config/config-validation`

### ControlPlaneStack

The `ControlPlaneStack` bundles component descriptors for control plane operations (creating family instances, running CLI commands, connecting to databases):

```ts
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import type { ControlPlaneStack } from '@prisma-next/core-control-plane/types';

// Create a stack with sensible defaults
const stack = createControlPlaneStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver, // optional, defaults to undefined
  extensionPacks: [pgvector], // optional, defaults to []
});

// Use stack for family instance creation
const familyInstance = config.family.create(stack);

// Stack is also used internally by ControlClient and CLI commands
```

### Error Factories

```ts
import {
  errorConfigFileNotFound,
  errorMarkerMissing,
  errorHashMismatch,
} from '@prisma-next/core-control-plane/errors';

throw errorConfigFileNotFound('prisma-next.config.ts', {
  why: 'Config file not found in current directory',
});
```

## Package Location

This package is part of the **framework domain**, **core layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: migration (control plane operations)
- **Path**: `packages/1-framework/1-core/migration/control-plane`

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
