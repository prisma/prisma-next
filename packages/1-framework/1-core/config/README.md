# @prisma-next/config

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

Config authoring types and validation for `prisma-next.config.ts`.

## Overview

This package owns the shared config contract used by tooling and authoring packages:

- `PrismaNextConfig` and `ContractConfig` types
- contract source provider + diagnostics protocol
- dev watch metadata for tooling integrations (`contract.watchInputs`, `contract.watchStrategy`)
- `defineConfig()` normalization/defaulting
- `validateConfig()` structural/runtime-shape validation

## Responsibilities

- Type-safe config composition for `family`, `target`, `adapter`, optional `driver`, and optional `extensionPacks` (`extensions` is rejected at runtime)
- Contract source provider protocol (`contract.source`) and diagnostics shape
- Optional dev watch hints for build integrations. `contract.watchInputs` declares authoritative source files that are not visible in the config module graph, while `contract.watchStrategy: 'moduleGraph'` declares that the config module graph is authoritative.
- Pure config validation and normalization with no file system access

## Non-responsibilities

- Config file discovery/loading (`c12`, file I/O) - handled by `@prisma-next/cli`
- CLI error envelope formatting and rendering - handled by CLI/errors package error utilities
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
    source: async () => /* Result<Contract, ContractSourceDiagnostics> */ null as never,
    watchInputs: ['./prisma/schema.prisma'],
  },
});

validateConfig(config);
```

If neither `contract.watchInputs` nor `contract.watchStrategy` is declared, config loading falls
back to the config file path for dev watchers and returns a partial-coverage warning so build
integrations can surface that limitation explicitly.
