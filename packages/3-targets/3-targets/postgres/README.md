# @prisma-next/target-postgres

Postgres target pack for Prisma Next.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the Postgres target descriptor (`SqlControlTargetDescriptor`) for CLI config. The target descriptor includes the target manifest with capabilities and type information, as well as factories for creating migration planners and runners.

## Responsibilities

- **Target Descriptor Export**: Exports the Postgres `SqlControlTargetDescriptor` for use in CLI configuration files
- **Manifest Loading**: Loads the Postgres target manifest from `packs/manifest.json` with capabilities and type information
- **Multi-Plane Support**: Provides both migration-plane (control) and runtime-plane entry points for the Postgres target
- **Planner Factory**: Implements `createPlanner()` to create Postgres-specific migration planners
- **Runner Factory**: Implements `createRunner()` to create Postgres-specific migration runners

This package spans multiple planes:
- **Migration plane** (`src/exports/control.ts`): Control plane entry point that exports `SqlControlTargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code (future)

## Usage

### Control Plane (CLI)

```typescript
import postgres from '@prisma-next/target-postgres/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';

// postgres is a SqlControlTargetDescriptor with:
// - kind: 'target'
// - familyId: 'sql'
// - targetId: 'postgres'
// - id: 'postgres'
// - manifest: ExtensionPackManifest
// - createPlanner(): creates a Postgres migration planner
// - createRunner(): creates a Postgres migration runner

// Create family instance with target, adapter, and driver
const family = sqlFamilyDescriptor.create({
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

// Create planner and runner from target descriptor
const planner = postgres.createPlanner(family);
const runner = postgres.createRunner(family);

// Plan and execute migrations
const planResult = planner.plan({ contract, schema, policy });
if (planResult.kind === 'success') {
  const executeResult = await runner.execute({
    plan: planResult.plan,
    driver,
    destinationContract: contract,
    policy,
  });
}
```

### Runtime Plane

```typescript
// Runtime entry point (future)
import { ... } from '@prisma-next/target-postgres/runtime';
```

## Architecture

This package provides both control and runtime entry points for the Postgres target. The control entry point loads the target manifest from `packs/manifest.json` and exports it as a `SqlControlTargetDescriptor`. The runtime entry point will provide target-specific runtime functionality in the future.

## Dependencies

- **`@prisma-next/family-sql`**: SQL family types (`SqlControlTargetDescriptor`, `SqlControlFamilyInstance`)
- **`@prisma-next/core-control-plane`**: Control plane types (`ControlTargetInstance`)
- **`@prisma-next/contract`**: Manifest types (`ExtensionPackManifest`)
- **`arktype`**: Runtime validation

**Dependents:**
- CLI configuration files import this package to register the Postgres target

## Exports

- `./control`: Control plane entry point for `SqlControlTargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code (future)

## Tests

This package ships a mix of fast planner unit tests and slower runner integration tests that require a dev Postgres instance (via `@prisma/dev`).

- **Default (`pnpm --filter @prisma-next/target-postgres test`)**: runs all tests including integration tests
- **Test files**:
  - `test/migrations/planner.case1.test.ts`: Planner unit tests
  - `test/migrations/runner.*.integration.test.ts`: Runner integration tests (basic, errors, idempotency, policy)

```bash
pnpm --filter @prisma-next/target-postgres test
```
