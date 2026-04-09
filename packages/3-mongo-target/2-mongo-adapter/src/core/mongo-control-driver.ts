import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { Db, MongoClient } from 'mongodb';

export interface MongoControlDriverInstance extends ControlDriverInstance<'mongo', 'mongo'> {
  readonly db: Db;
}

class MongoControlDriverImpl implements MongoControlDriverInstance {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  readonly db: Db;
  readonly #client: MongoClient;

  constructor(db: Db, client: MongoClient) {
    this.db = db;
    this.#client = client;
  }

  query(): Promise<never> {
    throw new Error('MongoDB control driver does not support SQL queries');
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function createMongoControlDriver(db: Db, client: MongoClient): MongoControlDriverInstance {
  return new MongoControlDriverImpl(db, client);
}
