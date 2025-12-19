# Branch 3 Manual Runner Harness

Use this checklist whenever you need to manually exercise the planner + runner stack with a live Postgres instance (per the Branch 3 acceptance note).

## Prerequisites

1. `pnpm install`
2. Local `pg_config`/libpq tooling available (the dev database helper spins up an embedded Postgres via `@prisma/dev`).

## Commands

```bash
# 1. Launch the runner integration test directly (spins up a dev Postgres, plans, runs, and verifies)
RUN_POSTGRES_TARGET_TESTS=true pnpx vitest run packages/targets/postgres/test/migrations/runner.integration.test.ts --runInBand
```

What this does:

- Builds a real SQL contract (see the fixture inside `runner.integration.test.ts`).
- Uses the Postgres target descriptor to construct the planner and runner with the SQL family instance.
- Spins up a temporary Postgres database, runs `plan → runner.execute`, verifies schema, marker, and ledger, then tears everything down.

## Expected Output

- Vitest should report three passing tests (`applies additive plan…`, `handles no-op plans…`, `surfaces precheck failures…`).
- In debug runs you can set `DEBUG=prisma-next:runner` (see `packages/targets/postgres/src/core/migrations/runner.ts`) to see each SQL step as it executes.

## Notes

- This harness is intentionally manual/opt-in. CI does **not** run it automatically, so use it before promoting Branch 3 to ensure the runner wiring works end-to-end against a live database.
- If you need to point the runner at a different contract, edit the contract fixture within `runner.integration.test.ts` and re-run the command above. Keep changes local; the committed fixture represents the smoke-test contract used for Branch 3 validation.

