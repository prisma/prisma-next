import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import postgres from '@prisma-next/postgres/runtime';
import { budgets, type Runtime, type SqlMiddleware } from '@prisma-next/sql-runtime';
import { contract } from '../../prisma/contract';

export async function getRuntime(
  databaseUrl: string,
  middleware: readonly SqlMiddleware[] = [
    createCacheMiddleware({ maxEntries: 1_000 }),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Promise<Runtime> {
  const client = postgres({
    contract,
    url: databaseUrl,
    middleware,
    extensions: [pgvector],
  });
  return client.connect();
}
