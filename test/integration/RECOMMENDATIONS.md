# Recommendations

## Observations
- The integration suite runs CLI/emitter/runtime tests under a single Vitest config, so failures are noisy and the whole suite must run even when only CLI pieces changed.
- Tests share a single Postgres dev database/port range and depend on manual `setupTestDatabase`/`teardownTestDatabase` calls, which ties the tests together and prevents parallel execution.
- Some tests (e.g., `contract-imports.integration.test.ts`) still reference `@prisma-next/sql-query`, blocking the removal of that legacy package.

## Suggested Actions
- Split the suite into focused configs (CLI, emitter, runtime) with their own fixtures so authors can run targeted integration subsets.
- Adopt per-test isolation (unique schema names or disposable databases) and add helpers to seed/clean state automatically so the tests can run safely in parallel.
- Update the tests to import only from the new packages (`@prisma-next/sql-lane`, `@prisma-next/sql-contract-ts`, etc.) so the legacy `sql-query` package can be retired once the references are gone.
