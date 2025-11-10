# Recommendations

## Observations
- `src/orm-builder.ts` is 1,106 lines and still hosts include logic, projection inference, and plan lowering.
- `src/schema.ts` duplicates code now found in `@prisma-next/sql-relational-core`, and it still imports `RuntimeContext` directly.
- `src/operations-registry.ts` uses heavy `as unknown as` casting and will diverge from the planned `@prisma-next/operations` package if left here.

## Suggested Actions
- Finish extracting SQL/ORM lanes and relational core modules, then delete the legacy copies to avoid drift.
- Block new code from landing here (e.g., via CODEOWNERS or lint rules) so contributors add features to the new packages.
- Add migration notes for downstream consumers so they stop importing from `@prisma-next/sql-query`.

