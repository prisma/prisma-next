# Recommendations

## Observations
- The package is intentionally empty (`src/index.ts` only exports nothing) yet it is published and still mentioned in docs, which confuses contributors who expect an actual authoring surface.
- There are no tests or validation, so nothing prevents someone from accidentally dropping SQL-specific code into this placeholder package.
- Downstream README references still point users to `@prisma-next/contract-ts` even though the SQL surface lives in `@prisma-next/sql-contract-ts`.

## Suggested Actions
- Clearly demarcate this package as a placeholder in the README and link to `@prisma-next/sql-contract-ts` for the current SQL-specific surface; consider renaming the README section to signal this.
- Add a simple test or lint rule that fails if new modules are added here until the target-agnostic surface is actually implemented.
- Once the generic authoring core is ready, document the intended responsibilities and the migration path from the SQL-only builder to the target-neutral one.
