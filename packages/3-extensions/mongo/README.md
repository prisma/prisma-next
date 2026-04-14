# @prisma-next/mongo

One-package MongoDB setup for Prisma Next. Install this single package to get config, runtime, and all transitive type dependencies.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config), runtime (runtime)

## Quick Start

```typescript
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
});
```

## Exports

### `@prisma-next/mongo/config`

Simplified `defineConfig` that pre-wires all MongoDB internals (family, target, adapter, driver, contract providers). Pass a contract path and optional db config.

### `@prisma-next/mongo/runtime`

Re-exports `createMongoRuntime` from `@prisma-next/mongo-runtime` for composing the MongoDB execution pipeline.

## Dependencies

This package bundles all the transitive dependencies needed for a MongoDB Prisma Next project, including those referenced in the emitted `contract.d.ts`:

- `@prisma-next/mongo-contract` (contract type definitions)
- `@prisma-next/adapter-mongo` (adapter + codec types)
- `@prisma-next/contract` (shared contract types)

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`
