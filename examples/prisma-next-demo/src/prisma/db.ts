import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres';
import { budgets } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
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
