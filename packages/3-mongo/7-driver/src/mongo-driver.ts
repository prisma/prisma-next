import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  FindWireCommand,
  InsertOneWireCommand,
  type MongoWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';
import { type Db, MongoClient, type Sort } from 'mongodb';

export interface MongoDriver {
  execute<Row = Record<string, unknown>>(wireCommand: MongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}

async function* executeFindCommand<Row>(db: Db, cmd: FindWireCommand): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  let cursor = collection.find(cmd.filter ?? {});
  if (cmd.projection) cursor = cursor.project(cmd.projection);
  if (cmd.sort) cursor = cursor.sort(cmd.sort as Sort);
  if (cmd.limit !== undefined) cursor = cursor.limit(cmd.limit);
  if (cmd.skip !== undefined) cursor = cursor.skip(cmd.skip);
  yield* cursor as AsyncIterable<Row>;
}

async function* executeInsertOneCommand<Row>(
  db: Db,
  cmd: InsertOneWireCommand,
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  const result = await collection.insertOne(cmd.document);
  yield { insertedId: result.insertedId } as Row;
}

async function* executeUpdateOneCommand<Row>(
  db: Db,
  cmd: UpdateOneWireCommand,
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  const result = await collection.updateOne(cmd.filter, cmd.update);
  yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount } as Row;
}

async function* executeDeleteOneCommand<Row>(
  db: Db,
  cmd: DeleteOneWireCommand,
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  const result = await collection.deleteOne(cmd.filter);
  yield { deletedCount: result.deletedCount } as Row;
}

async function* executeAggregateCommand<Row>(
  db: Db,
  cmd: AggregateWireCommand,
): AsyncIterable<Row> {
  const collection = db.collection(cmd.collection);
  const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
  yield* cursor as AsyncIterable<Row>;
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  return {
    execute<Row = Record<string, unknown>>(wireCommand: MongoWireCommand): AsyncIterable<Row> {
      if (wireCommand instanceof FindWireCommand) {
        return executeFindCommand<Row>(db, wireCommand);
      }
      if (wireCommand instanceof InsertOneWireCommand) {
        return executeInsertOneCommand<Row>(db, wireCommand);
      }
      if (wireCommand instanceof UpdateOneWireCommand) {
        return executeUpdateOneCommand<Row>(db, wireCommand);
      }
      if (wireCommand instanceof DeleteOneWireCommand) {
        return executeDeleteOneCommand<Row>(db, wireCommand);
      }
      if (wireCommand instanceof AggregateWireCommand) {
        return executeAggregateCommand<Row>(db, wireCommand);
      }
      throw new Error(`Unknown wire command type: ${wireCommand.constructor.name}`);
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}
