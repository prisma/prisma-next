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
    // Cache first: interceptors are consulted in registration order and
    // the first non-`undefined` result wins, so the cache gets first
    // claim. A hit skips only the driver call and per-row `onRow` hooks:
    // every middleware's `beforeExecute` (`lints`, `budgets`) has already
    // run before any `intercept` is consulted, and `afterExecute` still
    // fires for all of them with `source: 'middleware'`. The cache stores
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
