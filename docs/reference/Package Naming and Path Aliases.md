# Package Naming and Path Aliases

This document defines the relationship between the repository directory layout and published package names, and provides canonical TypeScript path aliases for local development.

## Naming Rules

- Use the published package name as the only import specifier. The directory layout is for humans and guardrails.
- Encode target family with a `sql-` (or future `doc-`) prefix in package names for discoverability.
- Collapse nested dirs to hyphenated names; no slashes after the scope.
- Keep conventional names for adapters/drivers (e.g., `@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`) even when nested under `packages/sql/postgres/**`.
- Rings (core/authoring/targets/lanes/runtime/adapters) constrain dependency direction; they generally do not appear in package names, except when meaningful (e.g., `runtime-executor`).

## Path → Package Name Examples

**Framework Domain:**
- `packages/contract` → `@prisma-next/contract` (legacy, will be migrated)
- `packages/framework/core-plan` → `@prisma-next/plan`
- `packages/framework/core-operations` → `@prisma-next/operations`
- `packages/framework/authoring/contract-authoring` → `@prisma-next/contract-authoring`
- `packages/framework/authoring/contract-ts` → `@prisma-next/contract-ts`
- `packages/framework/authoring/contract-psl` → `@prisma-next/contract-psl`
- `packages/framework/tooling/cli` → `@prisma-next/cli`
- `packages/framework/tooling/emitter` → `@prisma-next/emitter`
- `packages/framework/runtime-executor` → `@prisma-next/runtime-executor`

**SQL Domain:**
- `packages/sql/authoring/sql-contract-ts` → `@prisma-next/sql-contract-ts`
- `packages/sql/contract` → `@prisma-next/sql-contract`
- `packages/sql/operations` → `@prisma-next/sql-operations`
- `packages/sql/tooling/emitter` → `@prisma-next/sql-contract-emitter`
- `packages/sql/lanes/relational-core` → `@prisma-next/sql-relational-core`
- `packages/sql/lanes/sql-lane` → `@prisma-next/sql-lane`
- `packages/sql/lanes/orm-lane` → `@prisma-next/sql-orm-lane`
- `packages/sql/sql-runtime` → `@prisma-next/sql-runtime`
- `packages/sql/runtime/adapters/postgres` → `@prisma-next/adapter-postgres`
- `packages/sql/runtime/drivers/postgres` → `@prisma-next/driver-postgres`
- `packages/extensions/compat-prisma` → `@prisma-next/compat-prisma`

## Workspace Dependencies

Every import from another `@prisma-next/*` package requires an explicit `workspace:*` dependency in `package.json`. TypeScript resolves imports through `node_modules` symlinks created by pnpm.

### Adding a Dependency

```bash
# From the package directory
pnpm add @prisma-next/some-package@workspace:*
```

Or manually add to `package.json` (keep alphabetical order):

```json
{
  "dependencies": {
    "@prisma-next/some-package": "workspace:*"
  }
}
```

Then run `pnpm install` from the repository root to update the lockfile.

### Subpath Exports

Packages expose specific entrypoints via the `exports` field. Import from these subpaths, not internal file paths:

```typescript
// Correct — uses subpath export
import { createRuntime } from '@prisma-next/adapter-postgres/runtime';

// Incorrect — imports internal path
import { createRuntime } from '@prisma-next/adapter-postgres/dist/exports/runtime';
```

## Workspace Globs (pnpm)

```yaml
packages:
  - packages/framework/**
  - packages/sql/tooling/*
  - packages/sql/**
  - packages/runtime/*
  - packages/compat/*
  - packages/*
```

## Enforcement

- Use `scripts/check-imports.mjs` with `architecture.config.json` to enforce dependency direction: `core → authoring → targets → lanes → runtime-executor → family-runtime → adapters`.
- The import validation script enforces domain/layer/plane rules: same-layer imports allowed, downward imports allowed, upward imports denied, cross-domain imports denied except framework domain, migration→runtime imports denied, runtime→migration imports allowed for artifacts only.
