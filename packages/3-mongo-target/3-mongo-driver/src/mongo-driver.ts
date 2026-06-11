import type { MongoDriver } from '@prisma-next/mongo-lowering';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import type { IndexSpecification } from 'mongodb';
import type {
  AggregateWireCommand,
  AnyMongoWireCommand,
  CollModWireCommand,
  CreateCollectionWireCommand,
  CreateIndexWireCommand,
  DeleteManyResult,
  DeleteManyWireCommand,
  DeleteOneResult,
  DeleteOneWireCommand,
  DropCollectionWireCommand,
  DropIndexWireCommand,
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
import { DRIVER_INFO } from './core/driver-info';

async function* voidToAsyncIterable(op: Promise<void>): AsyncIterable<never> {
  await op;
}

export class MongoDriverImpl implements MongoDriver {
  protected readonly db: Db;
  protected readonly client: MongoClient | undefined;

  protected constructor(db: Db, client: MongoClient | undefined) {
    this.db = db;
    this.client = client;
  }

  static async fromConnection(uri: string, dbName: string): Promise<MongoDriverImpl> {
    const client = new MongoClient(uri, { driverInfo: DRIVER_INFO });
    await client.connect();
    return new MongoDriverImpl(client.db(dbName), client);
  }

  static fromDb(db: Db): MongoDriverImpl {
    return new MongoDriverImpl(db, undefined);
  }

  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row> {
    switch (wireCommand.kind) {
      case 'insertOne':
        return this.executeInsertOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return this.executeUpdateOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'insertMany':
        return this.executeInsertManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateMany':
        return this.executeUpdateManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return this.executeDeleteOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteMany':
        return this.executeDeleteManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndUpdate':
        return this.executeFindOneAndUpdateCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndDelete':
        return this.executeFindOneAndDeleteCommand(wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return this.executeAggregateCommand<Row>(wireCommand);
      case 'createCollection':
        return castAs<AsyncIterable<Row>>(voidToAsyncIterable(this.executeCreateCollectionCommand(wireCommand)));
      case 'createIndex':
        return castAs<AsyncIterable<Row>>(voidToAsyncIterable(this.executeCreateIndexCommand(wireCommand)));
      case 'dropCollection':
        return castAs<AsyncIterable<Row>>(voidToAsyncIterable(this.executeDropCollectionCommand(wireCommand)));
      case 'dropIndex':
        return castAs<AsyncIterable<Row>>(voidToAsyncIterable(this.executeDropIndexCommand(wireCommand)));
      case 'collMod':
        return castAs<AsyncIterable<Row>>(voidToAsyncIterable(this.executeCollModCommand(wireCommand)));
      // v8 ignore next 4
      default: {
        const _exhaustive: never = wireCommand;
        throw new Error(`Unknown wire command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  protected async *executeInsertOneCommand(
    cmd: InsertOneWireCommand,
  ): AsyncIterable<InsertOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.insertOne(cmd.document);
    yield { insertedId: result.insertedId };
  }

  protected async *executeUpdateOneCommand(
    cmd: UpdateOneWireCommand,
  ): AsyncIterable<UpdateOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.updateOne(cmd.filter, cmd.update, { upsert: cmd.upsert });
    yield {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ?? undefined,
    };
  }

  protected async *executeInsertManyCommand(
    cmd: InsertManyWireCommand,
  ): AsyncIterable<InsertManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.insertMany(cmd.documents as Record<string, unknown>[]);
    const insertedIds = Object.values(result.insertedIds);
    yield { insertedIds, insertedCount: result.insertedCount };
  }

  protected async *executeUpdateManyCommand(
    cmd: UpdateManyWireCommand,
  ): AsyncIterable<UpdateManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.updateMany(cmd.filter, cmd.update, { upsert: cmd.upsert });
    yield {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ?? undefined,
    };
  }

  protected async *executeDeleteOneCommand(
    cmd: DeleteOneWireCommand,
  ): AsyncIterable<DeleteOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.deleteOne(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  protected async *executeDeleteManyCommand(
    cmd: DeleteManyWireCommand,
  ): AsyncIterable<DeleteManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.deleteMany(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  protected async *executeFindOneAndUpdateCommand(
    cmd: FindOneAndUpdateWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.findOneAndUpdate(cmd.filter, cmd.update, {
      upsert: cmd.upsert,
      ...(cmd.returnDocument != null ? { returnDocument: cmd.returnDocument } : {}),
      ...(cmd.sort != null ? { sort: cmd.sort } : {}),
    });
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  protected async *executeFindOneAndDeleteCommand(
    cmd: FindOneAndDeleteWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.findOneAndDelete(cmd.filter, {
      ...(cmd.sort != null ? { sort: cmd.sort } : {}),
    });
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  protected async *executeAggregateCommand<Row>(cmd: AggregateWireCommand): AsyncIterable<Row> {
    const collection = this.db.collection(cmd.collection);
    const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
    yield* cursor as AsyncIterable<Row>;
  }

  protected async executeCreateCollectionCommand(cmd: CreateCollectionWireCommand): Promise<void> {
    await this.db.createCollection(cmd.collection, cmd.options);
  }

  protected async executeCreateIndexCommand(cmd: CreateIndexWireCommand): Promise<void> {
    await this.db
      .collection(cmd.collection)
      .createIndex(
        blindCast<IndexSpecification, 'key satisfies {[k:string]:IndexDirection}'>(cmd.key),
        cmd.options,
      );
  }

  protected async executeDropCollectionCommand(cmd: DropCollectionWireCommand): Promise<void> {
    await this.db.collection(cmd.collection).drop();
  }

  protected async executeDropIndexCommand(cmd: DropIndexWireCommand): Promise<void> {
    await this.db.collection(cmd.collection).dropIndex(cmd.name);
  }

  protected async executeCollModCommand(cmd: CollModWireCommand): Promise<void> {
    await this.db.command({ collMod: cmd.collection, ...cmd.options });
  }
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  return MongoDriverImpl.fromConnection(uri, dbName);
}
