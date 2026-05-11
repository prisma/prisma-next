import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import postgresServerless from '@prisma-next/postgres/serverless';
import { budgets, lints } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

/**
 * Module-scope client. Constructing once per isolate is correct: only the static
 * authoring surface (`sql`, `context`, `stack`, `contract`) is closure-cached.
 * The per-request runtime is acquired inside `fetch` via `db.connect({ url })`.
 */
export const db = postgresServerless<Contract>({
  contractJson,
  middleware: [
    createTelemetryMiddleware(),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 5_000,
    }),
  ],
});
