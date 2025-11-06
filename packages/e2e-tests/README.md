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

