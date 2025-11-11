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
- `packages/targets/sql/contract-types` → `@prisma-next/sql-contract-types`
- `packages/targets/sql/operations` → `@prisma-next/sql-operations`
- `packages/targets/sql/emitter` → `@prisma-next/sql-contract-emitter`
- `packages/sql/lanes/relational-core` → `@prisma-next/sql-relational-core`
- `packages/sql/lanes/sql-lane` → `@prisma-next/sql-lane`
- `packages/sql/lanes/orm-lane` → `@prisma-next/sql-orm-lane`
- `packages/sql/sql-runtime` → `@prisma-next/sql-runtime`
- `packages/adapter-postgres` → `@prisma-next/adapter-postgres`
- `packages/driver-postgres` → `@prisma-next/driver-postgres`
- `packages/compat-prisma` → `@prisma-next/compat-prisma`

## TypeScript Path Aliases (dev-time)

Use published package names as canonical import specifiers. Map them to `src/` entries in `tsconfig.base.json` for local development.

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@prisma-next/contract": ["packages/contract/src/exports/types.ts"],
      "@prisma-next/plan": ["packages/framework/core-plan/src/index.ts"],
      "@prisma-next/operations": ["packages/framework/core-operations/src/index.ts"],

      "@prisma-next/contract-authoring": ["packages/framework/authoring/contract-authoring/src/index.ts"],
      "@prisma-next/contract-ts": ["packages/framework/authoring/contract-ts/src/index.ts"],
      "@prisma-next/contract-psl": ["packages/framework/authoring/contract-psl/src/index.ts"],
      "@prisma-next/cli": ["packages/framework/tooling/cli/src/exports/index.ts"],
      "@prisma-next/emitter": ["packages/framework/tooling/emitter/src/exports/index.ts"],
      "@prisma-next/runtime-executor": ["packages/framework/runtime-executor/src/index.ts"],

      "@prisma-next/sql-contract-ts": ["packages/sql/authoring/sql-contract-ts/src/exports/index.ts"],
      "@prisma-next/sql-contract-types": ["packages/targets/sql/contract-types/src/index.ts"],
      "@prisma-next/sql-operations": ["packages/targets/sql/operations/src/index.ts"],
      "@prisma-next/sql-contract-emitter": ["packages/targets/sql/emitter/src/index.ts"],

      "@prisma-next/sql-relational-core": ["packages/sql/lanes/relational-core/src/index.ts"],
      "@prisma-next/sql-lane": ["packages/sql/lanes/sql-lane/src/index.ts"],
      "@prisma-next/sql-orm-lane": ["packages/sql/lanes/orm-lane/src/index.ts"],

      "@prisma-next/sql-runtime": ["packages/sql/sql-runtime/src/index.ts"],

      "@prisma-next/adapter-postgres": ["packages/adapter-postgres/src/exports/index.ts"],
      "@prisma-next/driver-postgres": ["packages/driver-postgres/src/exports/index.ts"],

      "@prisma-next/compat-prisma": ["packages/compat-prisma/src/exports/index.ts"]
    }
  }
}
```

Optional layer/group aliases for ergonomics (not for published imports):

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@framework/core/*": ["packages/framework/core-*/src"],
      "@framework/authoring/*": ["packages/framework/authoring/*/src"],
      "@framework/tooling/*": ["packages/framework/tooling/*/src"],
      "@framework/runtime-executor": ["packages/framework/runtime-executor/src"],
      "@targets/sql/*": ["packages/targets/sql/*/src"],
      "@sql/*": ["packages/sql/*/src"],
      "@adapters/*": ["packages/adapter-*/src"]
    }
  }
}
```

## Workspace Globs (pnpm)

```yaml
packages:
  - packages/framework/**
  - packages/targets/sql/*
  - packages/sql/**
  - packages/runtime/*
  - packages/compat/*
  - packages/*
```

## Enforcement

- Use `scripts/check-imports.mjs` with `architecture.config.json` to enforce dependency direction: `core → authoring → targets → lanes → runtime-executor → family-runtime → adapters`.
- The import validation script enforces domain/layer/plane rules: same-layer imports allowed, downward imports allowed, upward imports denied, cross-domain imports denied except framework domain, migration→runtime imports denied, runtime→migration imports allowed for artifacts only.

