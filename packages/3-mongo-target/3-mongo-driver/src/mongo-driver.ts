import type {
  AnyMongoWireCommand,
  DeleteOneResult,
  InsertOneResult,
  MongoDriver,
  UpdateOneResult,
} from '@prisma-next/mongo-core';
import { type Db, MongoClient, type Sort } from 'mongodb';

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
        return this.#executeFindCommand<Row>(wireCommand);
      case 'insertOne':
        return this.#executeInsertOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return this.#executeUpdateOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return this.#executeDeleteOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return this.#executeAggregateCommand<Row>(wireCommand);
      default: {
        const _exhaustive: never = wireCommand;
        throw new Error(`Unknown wire command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  async *#executeFindCommand<Row>(cmd: AnyMongoWireCommand & { kind: 'find' }): AsyncIterable<Row> {
    const collection = this.#db.collection(cmd.collection);
    let cursor = collection.find(cmd.filter ?? {});
    if (cmd.projection) cursor = cursor.project(cmd.projection);
    if (cmd.sort) cursor = cursor.sort(cmd.sort as Sort);
    if (cmd.limit !== undefined) cursor = cursor.limit(cmd.limit);
    if (cmd.skip !== undefined) cursor = cursor.skip(cmd.skip);
    yield* cursor as AsyncIterable<Row>;
  }

  async *#executeInsertOneCommand(
    cmd: AnyMongoWireCommand & { kind: 'insertOne' },
  ): AsyncIterable<InsertOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.insertOne(cmd.document);
    yield { insertedId: result.insertedId };
  }

  async *#executeUpdateOneCommand(
    cmd: AnyMongoWireCommand & { kind: 'updateOne' },
  ): AsyncIterable<UpdateOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.updateOne(cmd.filter, cmd.update);
    yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async *#executeDeleteOneCommand(
    cmd: AnyMongoWireCommand & { kind: 'deleteOne' },
  ): AsyncIterable<DeleteOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.deleteOne(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  async *#executeAggregateCommand<Row>(
    cmd: AnyMongoWireCommand & { kind: 'aggregate' },
  ): AsyncIterable<Row> {
    const collection = this.#db.collection(cmd.collection);
    const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
    yield* cursor as AsyncIterable<Row>;
  }
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  return new MongoDriverImpl(db, client);
}
