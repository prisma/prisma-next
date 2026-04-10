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
