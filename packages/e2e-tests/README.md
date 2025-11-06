# @prisma-next/e2e-tests

End-to-end tests that verify the full flow using the built CLI, emitted contract artifacts, SQL query builders, runtime, Postgres adapter and driver.

## What this tests
- Contract emission via CLI (single test verifies emission correctness)
- Load contracts from committed fixtures (not emit on every test run)
- Spin up dev Postgres instances and stamp contract markers
- Build plans from emitted artifacts and execute via runtime
- Assert multiple rows and verify compile-time row types
- Test nested projection shaping with flattened aliases

## Scripts
- `pnpm -F e2e-tests test` — run the test suite (requires repo build first)
- `pnpm -F e2e-tests test:coverage` — run tests with coverage (requires repo build first)
- `pnpm -F e2e-tests gen-contract` — regenerate committed fixture artifacts from `test/fixtures/contract.ts`

## Architecture

```mermaid
flowchart TD
    A[Contract TS] -->|CLI emit| B[Contract JSON + DTS]
    B -->|Load from fixtures| C[E2E Tests]
    C -->|withDevDatabase| D[Dev Postgres]
    C -->|setupE2EDatabase| E[Schema + Data + Marker]
    C -->|createTestRuntimeFromClient| F[Runtime]
    C -->|executePlanAndCollect| G[Query Results]
    G -->|Assert| H[Runtime Values + Types]
```

## Dependencies

- `@prisma-next/test-utils`: Shared test utilities (database, runtime, contract helpers)
- `@prisma-next/sql-query`: SQL query DSL and contract validation
- `@prisma-next/runtime`: Runtime execution engine
- `@prisma-next/adapter-postgres`: Postgres adapter
- `@prisma-next/driver-postgres`: Postgres driver

## Test Patterns

Tests use shared utilities from `@prisma-next/test-utils` via a wrapper file that injects dependencies:

```typescript
// Import from package-specific wrapper (injects dependencies)
import {
  withDevDatabase,
  withClient,
  loadContractFromDisk,
  setupE2EDatabase,
  createTestRuntimeFromClient,
  executePlanAndCollect,
} from './utils';  // Wrapper around @prisma-next/test-utils

// Load contract from committed fixtures (not emit on every test)
const contract = await loadContractFromDisk<Contract>(contractJsonPath);

await withDevDatabase(
  async ({ connectionString }) => {
    await withClient(connectionString, async (client) => {
      await setupE2EDatabase(client, contract, async (c) => {
        // Test-specific schema/data setup
      });

      const adapter = createPostgresAdapter();
      const runtime = createTestRuntimeFromClient(contract, client, adapter);
      try {
        const plan = sql({ contract, adapter }).from(tables.user).select({ ... }).build();
        const rows = await executePlanAndCollect(runtime, plan);
        // Assertions
      } finally {
        await runtime.close();
      }
    });
  },
  { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
);
```

## Contract Loading Strategy

- **Load from fixtures**: Tests load contracts from `test/fixtures/generated/contract.json` (committed artifacts)
- **Single emission test**: One test (`emitAndVerifyContract`) verifies that contract emission produces expected artifacts
- **Benefits**: Faster test execution, stable contract artifacts, reduced duplication

## Notes
- Build the repo first: `pnpm -w build`
- Uses unique ports for the dev DB to avoid conflicts (54020-54112 range)
- Type tests import the committed `test/fixtures/generated/contract.d.ts`
- Tests use shared utilities from `@prisma-next/test-utils` via `test/utils.ts` wrapper (injects dependencies)
- The `executePlanAndCollect` function properly infers return types using `ResultType<P>` from `@prisma-next/sql-query/types`

