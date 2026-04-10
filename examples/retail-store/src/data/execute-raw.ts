import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { Db } from '../db';

export async function executeRaw(db: Db, plan: MongoQueryPlan) {
  for await (const _ of db.runtime.execute(plan)) {
    /* drain the iterator to trigger execution */
  }
}

export async function collectResults<T>(db: Db, plan: MongoQueryPlan): Promise<T[]> {
  const results: T[] = [];
  for await (const row of db.runtime.execute(plan)) {
    results.push(row as T);
  }
  return results;
}

export async function collectFirstResult<T>(db: Db, plan: MongoQueryPlan): Promise<T | null> {
  for await (const row of db.runtime.execute(plan)) {
    return row as T;
  }
  return null;
}
