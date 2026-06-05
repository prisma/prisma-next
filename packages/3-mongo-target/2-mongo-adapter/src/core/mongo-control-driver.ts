import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { MongoDriver } from '@prisma-next/mongo-lowering';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';
import type { Db, MongoClient } from 'mongodb';

export interface MongoControlDriverInstance
  extends ControlDriverInstance<'mongo', 'mongo'>,
    MongoDriver {
  /**
   * The Db instance retained for the marker/ledger and introspection
   * path (executeAggregate / executeInsertOne / executeFindOneAndUpdate
   * + Db-based helpers). Retained until a follow-up migrates those
   * callers to driver.execute(wireCommand).
   */
  readonly db: Db;
}

class MongoControlDriverImpl implements MongoControlDriverInstance {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  readonly db: Db;
  readonly #client: MongoClient;
  readonly #driver: MongoDriver;

  constructor(db: Db, client: MongoClient) {
    this.db = db;
    this.#client = client;
    this.#driver = MongoDriverImpl.fromDb(db);
  }

  execute<Row>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row> {
    return this.#driver.execute<Row>(wireCommand);
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function isMongoControlDriver(
  driver: ControlDriverInstance<'mongo', string>,
): driver is MongoControlDriverInstance {
  return driver.familyId === 'mongo' && driver.targetId === 'mongo';
}

export function createMongoControlDriver(db: Db, client: MongoClient): MongoControlDriverInstance {
  return new MongoControlDriverImpl(db, client);
}
