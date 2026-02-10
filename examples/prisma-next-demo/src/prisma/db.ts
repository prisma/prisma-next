import pgvectorDescriptor from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { budgets } from '@prisma-next/sql-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/prisma_next_demo',
  extensions: [pgvectorDescriptor],
  plugins: [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
});

export const context = db.context;
export const schema = db.schema;
export const tables = db.schema.tables;
export const sql = db.sql;
export const orm = db.orm;
