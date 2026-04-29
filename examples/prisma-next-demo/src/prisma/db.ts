import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import postgres from '@prisma-next/postgres/runtime';
import { budgets, lints } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  extensions: [pgvector],
  middleware: [
    // Cache first so its `intercept` short-circuits before any other
    // middleware's `beforeExecute` fires on a hit. Telemetry's
    // `afterExecute` still runs on both paths and observes the
    // `source: 'driver' | 'middleware'` field, so cache hits are
    // visible through whichever observability sink is plugged in.
    createCacheMiddleware({ maxEntries: 1_000 }),
    createTelemetryMiddleware(),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
});
