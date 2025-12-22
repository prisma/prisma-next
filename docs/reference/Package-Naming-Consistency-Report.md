# Package Naming Consistency Report

This document reports on package naming inconsistencies found during the directory structure audit. These are suggestions for improving naming consistency across the repository.

## Summary

| Package | Current Name | Suggested Name | Reason |
|---------|-------------|----------------|--------|
| `packages/3-targets/3-targets/postgres/` | `@prisma-next/targets-postgres` | `@prisma-next/target-postgres` | Singular form for consistency with `adapter-` and `driver-` |
| `packages/3-extensions/pgvector/` | `@prisma-next/extension-pgvector` | `@prisma-next/ext-pgvector` | Shorter prefix per Extension-Packs-Naming-and-Layout.md convention |

## Details

### 1. `@prisma-next/targets-postgres`

**Current location:** `packages/3-targets/3-targets/postgres/`  
**Current name:** `@prisma-next/targets-postgres`  
**Suggested name:** `@prisma-next/target-postgres`

**Issue:** The name uses plural `targets-` prefix while related packages use singular prefixes:
- `@prisma-next/adapter-postgres` (not `adapters-postgres`)
- `@prisma-next/driver-postgres` (not `drivers-postgres`)

**Consistency pattern:** Use singular form for the type of thing being described:
- `target-postgres` - this is a target for Postgres
- `adapter-postgres` - this is an adapter for Postgres
- `driver-postgres` - this is a driver for Postgres

**Impact if changed:**
- Update `package.json` name field
- Update all imports across the codebase
- Update `architecture.config.json` references (if any)
- Update documentation references

---

### 2. `@prisma-next/extension-pgvector`

**Current location:** `packages/3-extensions/pgvector/`  
**Current name:** `@prisma-next/extension-pgvector`  
**Suggested name:** `@prisma-next/ext-pgvector`

**Issue:** The documented convention in `docs/reference/Extension-Packs-Naming-and-Layout.md` recommends:
> Prefer `@prisma-next/ext-<name>` or `@prisma-next/extension-<name>`

While `extension-` is acceptable per the doc, the shorter `ext-` prefix is preferred for brevity and consistency with future extension packs.

**Rationale for `ext-` prefix:**
- Shorter import paths
- More memorable
- Aligns with common npm conventions (e.g., `@types/...` instead of `@typescript-types/...`)

**Impact if changed:**
- Update `package.json` name field
- Update all imports across the codebase
- Update example apps and tests
- Update documentation references

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
| `packages/3-targets/6-adapters/postgres/` | `@prisma-next/adapter-postgres` | `adapter-` type prefix ✅ |
| `packages/3-targets/7-drivers/postgres/` | `@prisma-next/driver-postgres` | `driver-` type prefix ✅ |

### Extensions Domain
| Directory | Package Name | Pattern |
|-----------|--------------|---------|
| `packages/3-extensions/compat-prisma/` | `@prisma-next/compat-prisma` | `compat-` prefix for compatibility layers ✅ |

---

## Recommendations

1. **Low priority:** Consider renaming `@prisma-next/targets-postgres` to `@prisma-next/target-postgres` for singular consistency.

2. **Low priority:** Consider renaming `@prisma-next/extension-pgvector` to `@prisma-next/ext-pgvector` for brevity.

3. **For new packages:** Follow the established patterns:
   - SQL family: `@prisma-next/sql-<name>`
   - Targets: `@prisma-next/target-<db>`, `@prisma-next/adapter-<db>`, `@prisma-next/driver-<db>`
   - Extensions: `@prisma-next/ext-<name>`
   - Compatibility: `@prisma-next/compat-<name>`
   - Framework core: `@prisma-next/core-<name>` or just `@prisma-next/<name>`

---

## Decision Required

Before making any changes:
- [ ] Review this report
- [ ] Decide on `targets-` vs `target-` convention
- [ ] Decide on `extension-` vs `ext-` convention
- [ ] Update naming conventions documentation if patterns are changed
- [ ] Plan migration of imports if renames are approved