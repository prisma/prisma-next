import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import postgres from '@prisma-next/postgres/runtime';
import { budgets, lints, type SqlMiddleware } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

/**
 * Middleware tuple captured as a literal so the `const Mw` generic on
 * `postgres<...>(...)` infers the precise per-middleware type. Without
 * the `as const`, the array widens to `SqlMiddleware[]` and the
 * `AnnotationsOf<Mw>` projection on the resulting `PostgresClient`
 * collapses to `{}` — meaning lane terminals' `.annotate(callback)`
 * callback receives an empty `meta` builder with none of the
 * middleware-contributed annotations (the `cache` namespace produced
 * by `createCacheMiddleware` here).
 *
 * `satisfies readonly SqlMiddleware[]` checks each middleware against
 * the family-runtime constraint without widening the literal tuple.
 */
const middleware = [
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
] as const satisfies readonly SqlMiddleware[];

export const db = postgres<Contract, typeof middleware>({
  contractJson,
  extensions: [pgvector],
  middleware,
});
