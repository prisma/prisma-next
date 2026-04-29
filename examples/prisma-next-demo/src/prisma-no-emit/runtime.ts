import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import { budgets, createRuntime, type Runtime, type SqlMiddleware } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { context, stack } from './context';

export async function getRuntime(
  databaseUrl: string,
  middleware: SqlMiddleware[] = [
    // Cache first: short-circuits annotated reads on a hit before
    // telemetry's `beforeExecute` runs. Both middleware see the
    // `afterExecute` event regardless, so observability still works
    // for cached reads.
    createCacheMiddleware({ maxEntries: 1_000 }),
    createTelemetryMiddleware(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Promise<Runtime> {
  const pool = new Pool({ connectionString: databaseUrl });

  const stackInstance = instantiateExecutionStack(stack);
  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }

  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    middleware,
  });
}
