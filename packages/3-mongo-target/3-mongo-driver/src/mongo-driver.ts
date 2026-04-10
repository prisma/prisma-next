import type { MongoDriver } from '@prisma-next/mongo-lowering';
import type {
  AggregateWireCommand,
  AnyMongoWireCommand,
  DeleteManyResult,
  DeleteManyWireCommand,
  DeleteOneResult,
  DeleteOneWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyResult,
  InsertManyWireCommand,
  InsertOneResult,
  InsertOneWireCommand,
  UpdateManyResult,
  UpdateManyWireCommand,
  UpdateOneResult,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import { type Db, MongoClient } from 'mongodb';
import { version } from '../package.json' with { type: 'json' };

const DRIVER_INFO = { name: 'Prisma', version };

class MongoDriverImpl implements MongoDriver {
  readonly #db: Db;
  readonly #client: MongoClient;

  constructor(db: Db, client: MongoClient) {
    this.#db = db;
    this.#client = client;
  }

  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row> {
    switch (wireCommand.kind) {
      case 'insertOne':
        return this.#executeInsertOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return this.#executeUpdateOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'insertMany':
        return this.#executeInsertManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateMany':
        return this.#executeUpdateManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return this.#executeDeleteOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteMany':
        return this.#executeDeleteManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndUpdate':
        return this.#executeFindOneAndUpdateCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndDelete':
        return this.#executeFindOneAndDeleteCommand(wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return this.#executeAggregateCommand<Row>(wireCommand);
      // v8 ignore next 4
      default: {
        const _exhaustive: never = wireCommand;
        throw new Error(`Unknown wire command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  async *#executeInsertOneCommand(cmd: InsertOneWireCommand): AsyncIterable<InsertOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.insertOne(cmd.document);
    yield { insertedId: result.insertedId };
  }

  async *#executeUpdateOneCommand(cmd: UpdateOneWireCommand): AsyncIterable<UpdateOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.updateOne(cmd.filter, cmd.update);
    yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async *#executeInsertManyCommand(cmd: InsertManyWireCommand): AsyncIterable<InsertManyResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.insertMany(cmd.documents as Record<string, unknown>[]);
    const insertedIds = Object.values(result.insertedIds);
    yield { insertedIds, insertedCount: result.insertedCount };
  }

  async *#executeUpdateManyCommand(cmd: UpdateManyWireCommand): AsyncIterable<UpdateManyResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.updateMany(cmd.filter, cmd.update);
    yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async *#executeDeleteOneCommand(cmd: DeleteOneWireCommand): AsyncIterable<DeleteOneResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.deleteOne(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  async *#executeDeleteManyCommand(cmd: DeleteManyWireCommand): AsyncIterable<DeleteManyResult> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.deleteMany(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  async *#executeFindOneAndUpdateCommand(
    cmd: FindOneAndUpdateWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.findOneAndUpdate(cmd.filter, cmd.update, {
      returnDocument: 'after',
      upsert: cmd.upsert,
    });
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  async *#executeFindOneAndDeleteCommand(
    cmd: FindOneAndDeleteWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.#db.collection(cmd.collection);
    const result = await collection.findOneAndDelete(cmd.filter);
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  async *#executeAggregateCommand<Row>(cmd: AggregateWireCommand): AsyncIterable<Row> {
    const collection = this.#db.collection(cmd.collection);
    const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
    yield* cursor as AsyncIterable<Row>;
  }
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  const client = new MongoClient(uri, { driverInfo: DRIVER_INFO });
  await client.connect();
  const db = client.db(dbName);
  return new MongoDriverImpl(db, client);
}
