import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import postgres from '@prisma-next/postgres/runtime';
import { budgets, lints } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };
import { slowQueryWarning } from './slow-query-warning';

export const db = postgres<Contract>({
  contractJson,
  extensions: [pgvector],
  middleware: [
    // Cache first so its `intercept` short-circuits before any downstream
    // middleware (`lints`, `budgets`) fires on a hit. The cache stores
    // raw rows; the runtime still runs `decodeRow` on the hit path, so
    // consumers see decoded values in both cases.
    createCacheMiddleware({ maxEntries: 1_000 }),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
    // Custom middleware (see `slow-query-warning.ts`): observes every
    // execution's latency via `afterExecute` and logs a warning past the
    // threshold. Cache hits flow through it too, with `source: 'middleware'`.
    slowQueryWarning({ thresholdMs: 250 }),
  ],
});
