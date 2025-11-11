# @prisma-next/targets-postgres

Postgres target pack for Prisma Next.

## Package Classification

- **Domain**: extensions
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the Postgres target descriptor (`TargetDescriptor`) for CLI config. The target descriptor includes the target manifest with capabilities and type information.

This package spans multiple planes:
- **Migration plane** (`src/exports/cli.ts`): CLI entry point that exports `TargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code (future)

## Usage

### Migration Plane (CLI)

```typescript
import postgres from '@prisma-next/targets-postgres/cli';

// postgres is a TargetDescriptor with:
// - kind: 'target'
// - id: 'postgres'
// - family: 'sql'
// - manifest: ExtensionPackManifest
```

### Runtime Plane

```typescript
// Runtime entry point (future)
import { ... } from '@prisma-next/targets-postgres/runtime';
```

## Architecture

This package provides both CLI and runtime entry points for the Postgres target. The CLI entry point loads the target manifest from `packs/manifest.json` and exports it as a `TargetDescriptor`. The runtime entry point will provide target-specific runtime functionality in the future.

## Exports

- `./cli`: Migration entry point for `TargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code (future)

