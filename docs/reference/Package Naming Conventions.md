# Package Naming Conventions

This document defines the relationship between the repository directory layout and published package names.

## Directory Structure

The repository uses numbered prefixes in directory names to reflect the architecture hierarchy:

```
packages/
  1-framework/           # Domain 1: Framework (target-agnostic)
    1-core/              # Layer 1: Core
      shared/            # Plane: Shared
      migration/         # Plane: Migration
      runtime/           # Plane: Runtime
    2-authoring/         # Layer 2: Authoring
    3-tooling/           # Layer 3: Tooling
    4-runtime-executor/  # Layer 4: Runtime Executor
  2-document/            # Domain 2: Document (placeholder)
  2-sql/                 # Domain 2: SQL family
    1-core/              # Layer 1: Core
    2-authoring/         # Layer 2: Authoring
    3-tooling/           # Layer 3: Tooling
    4-lanes/             # Layer 4: Lanes
    5-runtime/           # Layer 5: Runtime
  3-extensions/          # Domain 3: Extensions
  3-targets/             # Domain 3: Targets
    3-targets/           # Layer 3: Target descriptors
    6-adapters/          # Layer 6: Adapters
    7-drivers/           # Layer 7: Drivers
```

The numbered prefixes serve two purposes:
1. **Visual hierarchy**: Makes domain/layer relationships clear at a glance
2. **Dependency direction**: Lower numbers can be imported by higher numbers, never the reverse

Planes (shared, migration, runtime) appear as subdirectories only when a layer contains packages in multiple planes.

## Naming Rules

- Use the published package name as the only import specifier. The directory layout is for humans and guardrails.
- Encode target family with a `sql-` (or future `doc-`) prefix in package names for discoverability.
- Collapse nested dirs to hyphenated names; no slashes after the scope.
- Keep conventional names for adapters/drivers (e.g., `@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`) even when nested under `packages/3-targets/**`.
- Layers (core/authoring/tooling/lanes/runtime/adapters) constrain dependency direction; they generally do not appear in package names, except when meaningful (e.g., `runtime-executor`).

## Path → Package Name Examples

**Framework Domain:**

| Directory | Package Name |
|-----------|--------------|
| `packages/1-framework/1-core/shared/contract/` | `@prisma-next/contract` |
| `packages/1-framework/1-core/shared/plan/` | `@prisma-next/plan` |
| `packages/1-framework/1-core/shared/operations/` | `@prisma-next/operations` |
| `packages/1-framework/1-core/migration/control-plane/` | `@prisma-next/core-control-plane` |
| `packages/1-framework/1-core/runtime/execution-plane/` | `@prisma-next/core-execution-plane` |
| `packages/1-framework/2-authoring/contract/` | `@prisma-next/contract-authoring` |
| `packages/1-framework/2-authoring/contract-ts/` | `@prisma-next/contract-ts` |
| `packages/1-framework/2-authoring/contract-psl/` | `@prisma-next/contract-psl` |
| `packages/1-framework/3-tooling/cli/` | `@prisma-next/cli` |
| `packages/1-framework/3-tooling/emitter/` | `@prisma-next/emitter` |
| `packages/1-framework/4-runtime-executor/` | `@prisma-next/runtime-executor` |

**SQL Domain:**

| Directory | Package Name |
|-----------|--------------|
| `packages/2-sql/1-core/contract/` | `@prisma-next/sql-contract` |
| `packages/2-sql/1-core/operations/` | `@prisma-next/sql-operations` |
| `packages/2-sql/1-core/schema-ir/` | `@prisma-next/sql-schema-ir` |
| `packages/2-sql/2-authoring/contract-ts/` | `@prisma-next/sql-contract-ts` |
| `packages/2-sql/3-tooling/emitter/` | `@prisma-next/sql-contract-emitter` |
| `packages/2-sql/3-tooling/family/` | `@prisma-next/family-sql` |
| `packages/2-sql/4-lanes/relational-core/` | `@prisma-next/sql-relational-core` |
| `packages/2-sql/4-lanes/sql-lane/` | `@prisma-next/sql-lane` |
| `packages/2-sql/5-runtime/` | `@prisma-next/sql-runtime` |

**Targets Domain:**

| Directory | Package Name |
|-----------|--------------|
| `packages/3-targets/3-targets/postgres/` | `@prisma-next/target-postgres` |
| `packages/3-targets/6-adapters/postgres/` | `@prisma-next/adapter-postgres` |
| `packages/3-targets/7-drivers/postgres/` | `@prisma-next/driver-postgres` |

**Extensions Domain:**

| Directory | Package Name |
|-----------|--------------|
| `packages/3-extensions/pgvector/` | `@prisma-next/extension-pgvector` |

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
  - packages/**
  - examples/*
  - test/**
```

## Enforcement

- Use `scripts/check-imports.mjs` with `architecture.config.json` to enforce dependency direction: `core → authoring → tooling → lanes → runtime-executor → family-runtime → adapters`.
- The import validation script enforces domain/layer/plane rules: same-layer imports allowed, downward imports allowed, upward imports denied, cross-domain imports denied except framework domain, migration→runtime imports denied, runtime→migration imports allowed for artifacts only.
- Numbered directory prefixes provide visual reinforcement of dependency direction.
