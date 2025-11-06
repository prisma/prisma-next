# @prisma-next/e2e-tests

End-to-end tests that verify the full flow using the built CLI, emitted contract artifacts, SQL query builders, runtime, Postgres adapter and driver.

## What this tests
- Emit a real contract via the CLI from a local TS contract
- Spin up a dev Postgres instance and stamp contract marker
- Build a plan from emitted artifacts and execute via runtime
- Assert multiple rows and verify compile-time row types

## Scripts
- `pnpm -F e2e-tests test` — run the test suite (requires repo build first)
- `pnpm -F e2e-tests test:coverage` — run tests with coverage (requires repo build first)
- `pnpm -F e2e-tests gen-contract` — regenerate committed fixture artifacts from `test/fixtures/contract.ts`

## Notes
- Build the repo first: `pnpm -w build`
- Uses unique ports for the dev DB to avoid conflicts
- Type tests import the committed `test/fixtures/generated/contract.d.ts`

## Test Utilities

Contract-related test utilities are located in `e2e-tests/test/utils.ts`. These utilities depend on `@prisma-next/sql-query` and `@prisma-next/sql-target` for contract validation and types.

**Available Utilities:**
- `loadContractFromDisk<TContract>(contractJsonPath)`: Loads an already-emitted contract from disk. The generic type parameter should be specified from the emitted `contract.d.ts` file (e.g., `loadContractFromDisk<Contract>(contractJsonPath)`).
- `emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, expectedContractJsonPath)`: Emits contract via CLI and verifies it matches on-disk artifacts. Used in a single test to verify contract emission correctness.

**Usage:**
```typescript
import { loadContractFromDisk, emitAndVerifyContract } from './utils';
import type { Contract } from './fixtures/generated/contract.d';

// Load contract from committed fixtures
const contract = await loadContractFromDisk<Contract>(contractJsonPath);

// Emit and verify contract
await emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, expectedContractJsonPath);
```

**Note**: These utilities are local to the e2e-tests package and depend on `@prisma-next/sql-query` and `@prisma-next/sql-target`. They are not exported from `@prisma-next/test-utils` to avoid circular dependencies.

