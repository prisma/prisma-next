# @prisma-next/config

Config authoring types and validation for `prisma-next.config.ts`.

## Overview

This package owns the shared config contract used by tooling and authoring packages:

- `PrismaNextConfig` and `ContractConfig` types
- contract source provider + diagnostics protocol
- `defineConfig()` normalization/defaulting
- `validateConfig()` structural/runtime-shape validation

## Responsibilities

- Type-safe config composition for `family`, `target`, `adapter`, optional `driver`, and optional `extensionPacks`
- Contract source provider protocol (`contract.source`) and diagnostics shape
- Pure config validation and normalization with no file system access

## Non-responsibilities

- Config file discovery/loading (`c12`, file I/O) - handled by `@prisma-next/cli`
- CLI error envelope formatting and rendering - handled by CLI/core-control-plane error utilities
- Control-plane migration operations and runtime actions

## Usage

```ts
import { defineConfig } from '@prisma-next/config/config-types';
import { validateConfig } from '@prisma-next/config/config-validation';

const config = defineConfig({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  contract: {
    source: async () => /* Result<ContractIR, ContractSourceDiagnostics> */ null as never,
  },
});

validateConfig(config);
```
