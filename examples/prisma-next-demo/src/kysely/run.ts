import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function executeKyselyQuery<Row>(
  runtime: Runtime,
  query: { compile(): unknown },
): Promise<Row[]> {
  const plan = db.kysely.build(query as { compile(): never });
  return runtime.execute(plan).toArray() as Promise<Row[]>;
}

export async function executeKyselyTakeFirst<Row>(
  runtime: Runtime,
  query: { compile(): unknown },
): Promise<Row | null> {
  const rows = await executeKyselyQuery<Row>(runtime, query);
  return rows[0] ?? null;
}

export async function executeKyselyTakeFirstOrThrow<Row>(
  runtime: Runtime,
  query: { compile(): unknown },
): Promise<Row> {
  const row = await executeKyselyTakeFirst<Row>(runtime, query);
  if (!row) {
    throw new Error('Expected at least one row');
  }
  return row;
}
