# Package Naming Consistency Report

This document reports on package naming consistency across the repository and documents resolved naming issues.

## Summary

All package naming inconsistencies have been resolved. ✅

| Package | Previous Name | Current Name | Status |
|---------|---------------|--------------|--------|
| `packages/3-targets/3-targets/postgres/` | `@prisma-next/targets-postgres` | `@prisma-next/target-postgres` | ✅ Resolved |

## Resolved Issues

### 1. `@prisma-next/target-postgres` (Resolved)

**Location:** `packages/3-targets/3-targets/postgres/`  
**Previous name:** `@prisma-next/targets-postgres`  
**Current name:** `@prisma-next/target-postgres`

**Issue:** The name used plural `targets-` prefix while related packages use singular prefixes:
- `@prisma-next/adapter-postgres` (not `adapters-postgres`)
- `@prisma-next/driver-postgres` (not `drivers-postgres`)

**Resolution:** Renamed to use singular form `target-` for consistency.

---

## Packages with Consistent Naming ✅

The following packages follow consistent naming patterns:

### Framework Domain
| Directory | Package Name | Pattern |
|-----------|--------------|---------|
| `packages/1-framework/1-core/shared/contract/` | `@prisma-next/contract` | Core package, no prefix |
| `packages/1-framework/1-core/shared/plan/` | `@prisma-next/plan` | Core package, no prefix |
| `packages/1-framework/1-core/shared/operations/` | `@prisma-next/operations` | Core package, no prefix |
| `packages/1-framework/1-core/migration/control-plane/` | `@prisma-next/core-control-plane` | `core-` prefix for framework core |
| `packages/1-framework/1-core/runtime/execution-plane/` | `@prisma-next/core-execution-plane` | `core-` prefix for framework core |
| `packages/1-framework/2-authoring/contract/` | `@prisma-next/contract-authoring` | Descriptive compound name |
| `packages/1-framework/3-tooling/cli/` | `@prisma-next/cli` | Short, clear name |
| `packages/1-framework/3-tooling/emitter/` | `@prisma-next/emitter` | Short, clear name |
| `packages/1-framework/4-runtime-executor/` | `@prisma-next/runtime-executor` | Layer in name for clarity |

### SQL Domain
| Directory | Package Name | Pattern |
|-----------|--------------|---------|
| `packages/2-sql/1-core/contract/` | `@prisma-next/sql-contract` | `sql-` family prefix |
| `packages/2-sql/1-core/operations/` | `@prisma-next/sql-operations` | `sql-` family prefix |
| `packages/2-sql/1-core/schema-ir/` | `@prisma-next/sql-schema-ir` | `sql-` family prefix |
| `packages/2-sql/2-authoring/contract-ts/` | `@prisma-next/sql-contract-ts` | `sql-` family prefix |
| `packages/2-sql/3-tooling/emitter/` | `@prisma-next/sql-contract-emitter` | `sql-` family prefix |
| `packages/2-sql/3-tooling/family/` | `@prisma-next/family-sql` | `family-` prefix for descriptors |
| `packages/2-sql/4-lanes/relational-core/` | `@prisma-next/sql-relational-core` | `sql-` family prefix |
| `packages/2-sql/4-lanes/sql-lane/` | `@prisma-next/sql-lane` | `sql-` family prefix |
| `packages/2-sql/4-lanes/orm-lane/` | `@prisma-next/sql-orm-lane` | `sql-` family prefix |
| `packages/2-sql/5-runtime/` | `@prisma-next/sql-runtime` | `sql-` family prefix |

### Targets Domain
| Directory | Package Name | Pattern |
|-----------|--------------|---------|
| `packages/3-targets/3-targets/postgres/` | `@prisma-next/target-postgres` | `target-` type prefix ✅ |
| `packages/3-targets/6-adapters/postgres/` | `@prisma-next/adapter-postgres` | `adapter-` type prefix ✅ |
| `packages/3-targets/7-drivers/postgres/` | `@prisma-next/driver-postgres` | `driver-` type prefix ✅ |

### Extensions Domain
| Directory | Package Name | Pattern |
|-----------|--------------|---------|
| `packages/3-extensions/pgvector/` | `@prisma-next/extension-pgvector` | `extension-` prefix for extension packs ✅ |
| `packages/3-extensions/compat-prisma/` | `@prisma-next/compat-prisma` | `compat-` prefix for compatibility layers ✅ |

---

## Naming Conventions

For new packages, follow the established patterns:

- **SQL family:** `@prisma-next/sql-<name>`
- **Targets:** `@prisma-next/target-<db>`, `@prisma-next/adapter-<db>`, `@prisma-next/driver-<db>`
- **Extensions:** `@prisma-next/extension-<name>`
- **Compatibility:** `@prisma-next/compat-<name>`
- **Framework core:** `@prisma-next/core-<name>` or just `@prisma-next/<name>`

---

## Decisions Made

- [x] ~~Decide on `targets-` vs `target-` convention~~ — **Resolved:** Use singular `target-` prefix for consistency with `adapter-` and `driver-`
- [x] ~~Decide on `extension-` vs `ext-` convention~~ — **Resolved:** Use `extension-` prefix exclusively (see [ADR 153](../architecture%20docs/adrs/ADR%20153%20-%20Extension%20Package%20Naming%20Convention.md))