# @prisma-next/targets-postgres

Postgres target pack for Prisma Next.

## Purpose

Provides the Postgres target descriptor (`TargetDescriptor`) for CLI config. The target descriptor includes the target manifest with capabilities and type information.

## Usage

```typescript
import postgres from '@prisma-next/targets-postgres/cli';

// postgres is a TargetDescriptor with:
// - kind: 'target'
// - id: 'postgres'
// - family: 'sql'
// - manifest: ExtensionPackManifest
```

## Architecture

This package is the CLI entry point for the Postgres target. It loads the target manifest from `packs/manifest.json` and exports it as a `TargetDescriptor`.

