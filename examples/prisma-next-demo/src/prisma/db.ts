import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { budgets } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export function createDb(databaseUrl: string) {
  return postgres<Contract>({
    contractJson,
    url: databaseUrl,
    extensions: [pgvector],
    plugins: [
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
        maxLatencyMs: 1_000,
      }),
    ],
  });
}
