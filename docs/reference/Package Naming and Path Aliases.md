# Package Naming and Path Aliases

This document defines the relationship between the repository directory layout and published package names, and provides canonical TypeScript path aliases for local development.

## Naming Rules

- Use the published package name as the only import specifier. The directory layout is for humans and guardrails.
- Encode target family with a `sql-` (or future `doc-`) prefix in package names for discoverability.
- Collapse nested dirs to hyphenated names; no slashes after the scope.
- Keep conventional names for adapters/drivers (e.g., `@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`) even when nested under `packages/sql/postgres/**`.
- Rings (core/authoring/targets/lanes/runtime/adapters) constrain dependency direction; they generally do not appear in package names, except when meaningful (e.g., `runtime-core`).

## Path → Package Name Examples

- `packages/core/contract` → `@prisma-next/contract`
- `packages/core/plan` → `@prisma-next/plan`
- `packages/core/operations` → `@prisma-next/operations`

- `packages/authoring/contract-authoring` → `@prisma-next/contract-authoring`
- `packages/authoring/contract-psl` → `@prisma-next/contract-psl`
- `packages/sql/authoring/sql-contract-ts` → `@prisma-next/sql-contract-ts`

- `packages/targets/sql/contract-types` → `@prisma-next/sql-contract-types`
- `packages/targets/sql/operations` → `@prisma-next/sql-operations`
- `packages/targets/sql/emitter` → `@prisma-next/sql-contract-emitter`

- `packages/sql/lanes/relational-core` → `@prisma-next/sql-relational-core`
- `packages/sql/lanes/sql-lane` → `@prisma-next/sql-lane`
- `packages/sql/lanes/orm-lane` → `@prisma-next/sql-orm-lane`

- `packages/runtime/core` → `@prisma-next/runtime-core`
- `packages/sql/sql-runtime` → `@prisma-next/sql-runtime`

- `packages/sql/postgres/postgres-adapter` → `@prisma-next/adapter-postgres`
- `packages/sql/postgres/postgres-driver` → `@prisma-next/driver-postgres`

- `packages/compat/compat-prisma` → `@prisma-next/compat-prisma`

## TypeScript Path Aliases (dev-time)

Use published package names as canonical import specifiers. Map them to `src/` entries in `tsconfig.base.json` for local development.

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@prisma-next/contract": ["packages/core/contract/src/index.ts"],
      "@prisma-next/plan": ["packages/core/plan/src/index.ts"],
      "@prisma-next/operations": ["packages/core/operations/src/index.ts"],

      "@prisma-next/contract-authoring": ["packages/authoring/contract-authoring/src/index.ts"],
      "@prisma-next/contract-psl": ["packages/authoring/contract-psl/src/index.ts"],
      "@prisma-next/sql-contract-ts": ["packages/sql/authoring/sql-contract-ts/src/index.ts"],

      "@prisma-next/sql-contract-types": ["packages/targets/sql/contract-types/src/index.ts"],
      "@prisma-next/sql-operations": ["packages/targets/sql/operations/src/index.ts"],
      "@prisma-next/sql-contract-emitter": ["packages/targets/sql/emitter/src/index.ts"],

      "@prisma-next/sql-relational-core": ["packages/sql/lanes/relational-core/src/index.ts"],
      "@prisma-next/sql-lane": ["packages/sql/lanes/sql-lane/src/index.ts"],
      "@prisma-next/sql-orm-lane": ["packages/sql/lanes/orm-lane/src/index.ts"],

      "@prisma-next/runtime-core": ["packages/runtime/core/src/index.ts"],
      "@prisma-next/sql-runtime": ["packages/sql/sql-runtime/src/index.ts"],

      "@prisma-next/adapter-postgres": ["packages/sql/postgres/postgres-adapter/src/index.ts"],
      "@prisma-next/driver-postgres": ["packages/sql/postgres/postgres-driver/src/index.ts"],

      "@prisma-next/compat-prisma": ["packages/compat/compat-prisma/src/index.ts"]
    }
  }
}
```

Optional ring/group aliases for ergonomics (not for published imports):

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["packages/core/*/src"],
      "@authoring/*": ["packages/authoring/*/src"],
      "@targets/sql/*": ["packages/targets/sql/*/src"],
      "@sql/*": ["packages/sql/*/src"],
      "@runtime/*": ["packages/runtime/*/src"],
      "@adapters/*": ["packages/sql/*/*/src"]
    }
  }
}
```

## Workspace Globs (pnpm)

```yaml
packages:
  - packages/core/*
  - packages/authoring/*
  - packages/targets/sql/*
  - packages/sql/**
  - packages/runtime/*
  - packages/compat/*
```

## Enforcement

- Use ESLint `import/no-restricted-paths` (or `boundaries`) to enforce dependency direction: `core → authoring → targets → lanes → runtime-core → family-runtime → adapters`.
- Add a CI import-graph check (e.g., madge) to ensure inner rings never import outer rings and families don’t cross-import.

