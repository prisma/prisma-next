# Recommendations

## Observations
- Placeholder; `src/index.ts` exports nothing even though contract types are supposed to live here.
- Without real exports, other packages keep importing from `@prisma-next/sql-target`.

## Suggested Actions
- Move `SqlContract`, `SqlStorage`, and mapping helpers into this package with documentation for each field.
- Add schema-validation tests so emitters/runtimes can rely on these definitions.

