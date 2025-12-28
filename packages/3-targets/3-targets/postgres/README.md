# @prisma-next/target-postgres

Postgres target pack for Prisma Next.

## Package Classification

- **Domain**: extensions
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the Postgres target descriptor (`TargetDescriptor`) for CLI config. The target descriptor includes the target manifest with capabilities and type information.

## Responsibilities

- **Target Descriptor Export**: Exports the Postgres `TargetDescriptor` for use in CLI configuration files
- **Manifest Loading**: Loads the Postgres target manifest from `packs/manifest.json` with capabilities and type information
- **Multi-Plane Support**: Provides both migration-plane (CLI) and runtime-plane entry points for the Postgres target
- **Planner Factory**: Implements the SQL family `SqlControlTargetDescriptor` extension so callers can request a Postgres-specific `MigrationPlanner`

This package spans multiple planes:
- **Migration plane** (`src/exports/cli.ts`): CLI entry point that exports `TargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code (future)

## Usage

### Migration Plane (CLI)

```typescript
import postgres from '@prisma-next/target-postgres/control';

// postgres is a TargetDescriptor with:
// - kind: 'target'
// - id: 'postgres'
// - family: 'sql'
// - manifest: ExtensionPackManifest

// When paired with the SQL family, targets can expose planners
const family = sqlFamilyDescriptor.create({ target: postgres, adapter, driver, extensions: [] });
const planner = postgres.createPlanner(family);
const planResult = planner.plan({ contract, schema, policy });
```

### Runtime Plane

```typescript
// Runtime entry point (future)
import { ... } from '@prisma-next/target-postgres/runtime';
```

## Architecture

This package provides both CLI and runtime entry points for the Postgres target. The CLI entry point loads the target manifest from `packs/manifest.json` and exports it as a `TargetDescriptor`. The runtime entry point will provide target-specific runtime functionality in the future.

## Dependencies

- **`@prisma-next/cli`**: CLI descriptor types (`TargetDescriptor`, `ExtensionPackManifest`)
- **`arktype`**: Runtime validation

**Dependents:**
- CLI configuration files import this package to register the Postgres target

## Exports

- `./cli`: Migration entry point for `TargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code (future)

## Tests

This package ships a mix of fast planner unit tests and slower runner integration tests that require a dev Postgres instance (via `@prisma/dev`). The integration suite is opt-in to keep `pnpm test` fast and sandbox-friendly.

- **Default (`pnpm --filter @prisma-next/target-postgres test`)**: runs only the fast planner tests. The runner suite is skipped.
- **Full runner coverage**: opt in with an environment flag and run with elevated permissions so the embedded Postgres server can bind to localhost ports.

```bash
RUN_POSTGRES_TARGET_TESTS=true pnpm --filter @prisma-next/target-postgres test
```

The same flag is required when invoking `vitest` directly (e.g. for watch mode).

