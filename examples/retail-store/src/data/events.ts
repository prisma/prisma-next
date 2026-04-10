import { acc } from '@prisma-next/mongo-pipeline-builder';
import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import type { Db } from '../db';

export function createEvent(
  db: Db,
  event: {
    userId: string;
    sessionId: string;
    type: string;
    timestamp: Date;
    metadata: {
      productId: string | null;
      subCategory: string | null;
      brand: string | null;
      query: string | null;
      exitMethod: string | null;
    };
  },
) {
  return db.orm.events.create(event);
}

export function findEventsByUser(db: Db, userId: string) {
  return db.orm.events.where(MongoFieldFilter.eq('userId', userId)).all();
}

export async function aggregateEventsByType(db: Db, userId: string) {
  const plan = db.pipeline
    .from('events')
    .match(MongoFieldFilter.eq('userId', userId))
    .group((f) => ({
      _id: f.type,
      count: acc.count(),
    }))
    .sort({ count: -1 })
    .build();

  const results: Array<{ _id: string; count: number }> = [];
  for await (const row of db.runtime.execute(plan)) {
    results.push(row as { _id: string; count: number });
  }
  return results;
}
