import type {
  AnyMongoWireCommand,
  DeleteOneResult,
  InsertOneResult,
  MongoDriver,
  UpdateOneResult,
} from '@prisma-next/mongo-core';
import { type Db, MongoClient, type Sort } from 'mongodb';

async function* executeFindCommand<Row>(
  db: Db,
  cmd: AnyMongoWireCommand & { kind: 'find' },
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  let cursor = collection.find(cmd.filter ?? {});
  if (cmd.projection) cursor = cursor.project(cmd.projection);
  if (cmd.sort) cursor = cursor.sort(cmd.sort as Sort);
  if (cmd.limit !== undefined) cursor = cursor.limit(cmd.limit);
  if (cmd.skip !== undefined) cursor = cursor.skip(cmd.skip);
  yield* cursor as AsyncIterable<Row>;
}

async function* executeInsertOneCommand(
  db: Db,
  cmd: AnyMongoWireCommand & { kind: 'insertOne' },
): AsyncIterable<InsertOneResult> {
  const collection = db.collection(cmd.collection);
  const result = await collection.insertOne(cmd.document);
  yield { insertedId: result.insertedId };
}

async function* executeUpdateOneCommand(
  db: Db,
  cmd: AnyMongoWireCommand & { kind: 'updateOne' },
): AsyncIterable<UpdateOneResult> {
  const collection = db.collection(cmd.collection);
  const result = await collection.updateOne(cmd.filter, cmd.update);
  yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
}

async function* executeDeleteOneCommand(
  db: Db,
  cmd: AnyMongoWireCommand & { kind: 'deleteOne' },
): AsyncIterable<DeleteOneResult> {
  const collection = db.collection(cmd.collection);
  const result = await collection.deleteOne(cmd.filter);
  yield { deletedCount: result.deletedCount };
}

async function* executeAggregateCommand<Row>(
  db: Db,
  cmd: AnyMongoWireCommand & { kind: 'aggregate' },
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
  yield* cursor as AsyncIterable<Row>;
}

class MongoDriverImpl implements MongoDriver {
  readonly #db: Db;
  readonly #client: MongoClient;

  constructor(db: Db, client: MongoClient) {
    this.#db = db;
    this.#client = client;
  }

  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row> {
    switch (wireCommand.kind) {
      case 'find':
        return executeFindCommand<Row>(this.#db, wireCommand);
      case 'insertOne':
        return executeInsertOneCommand(this.#db, wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return executeUpdateOneCommand(this.#db, wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return executeDeleteOneCommand(this.#db, wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return executeAggregateCommand<Row>(this.#db, wireCommand);
      default:
        throw new Error(`Unknown wire command kind: ${(wireCommand as { kind: string }).kind}`);
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  return new MongoDriverImpl(db, client);
}
