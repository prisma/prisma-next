import type { Runtime } from '@prisma-next/sql-runtime';
import type { CompiledQuery, Kysely } from 'kysely';
import { db } from '../prisma/db';

type BuildableKyselyQuery<Row> = {
  compile(): CompiledQuery<Row> | unknown;
};

type DemoDb = Record<string, Record<string, unknown>>;

export function getDemoKysely(): Kysely<DemoDb> {
  return db.kysely as unknown as Kysely<DemoDb>;
}

export async function executeKyselyQuery<Row>(
  runtime: Runtime,
  query: BuildableKyselyQuery<Row>,
): Promise<Row[]> {
  const plan = db.kysely.build<Row>(query);
  return runtime.execute(plan).toArray() as Promise<Row[]>;
}

export async function executeKyselyTakeFirst<Row>(
  runtime: Runtime,
  query: BuildableKyselyQuery<Row>,
): Promise<Row | null> {
  const rows = await executeKyselyQuery<Row>(runtime, query);
  return rows[0] ?? null;
}

export async function executeKyselyTakeFirstOrThrow<Row>(
  runtime: Runtime,
  query: BuildableKyselyQuery<Row>,
): Promise<Row> {
  const row = await executeKyselyTakeFirst<Row>(runtime, query);
  if (!row) {
    throw new Error('Expected at least one row');
  }
  return row;
}
