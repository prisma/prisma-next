import { acc } from '@prisma-next/mongo-pipeline-builder';
import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import type { Db } from '../db';
import { collectResults } from './execute-raw';

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

interface EventTypeCount {
  _id: string;
  count: number;
}

export async function aggregateEventsByType(db: Db, userId: string): Promise<EventTypeCount[]> {
  const plan = db.pipeline
    .from('events')
    .match(MongoFieldFilter.eq('userId', userId))
    .group((f) => ({
      _id: f.type,
      count: acc.count(),
    }))
    .sort({ count: -1 })
    .build();

  return collectResults<EventTypeCount>(db, plan);
}
