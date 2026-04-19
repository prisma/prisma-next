import {
  AggregateWireCommand,
  type AnyMongoWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MigrationMongoDriver } from '../src/core/dml-executor';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db('dml_executor_test');
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.dropCollection(col['name'] as string);
  }
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) results.push(item);
  return results;
}

describe('MigrationMongoDriver', () => {
  it('executes insertOne', async () => {
    await db.createCollection('items');
    const driver = new MigrationMongoDriver(db);
    const cmd = new InsertOneWireCommand('items', { name: 'test' });
    const results = await collect(driver.execute(cmd));
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('insertedId');

    const docs = await db.collection('items').find().toArray();
    expect(docs).toHaveLength(1);
  });

  it('executes insertMany', async () => {
    await db.createCollection('items');
    const driver = new MigrationMongoDriver(db);
    const cmd = new InsertManyWireCommand('items', [{ a: 1 }, { a: 2 }]);
    const results = await collect(driver.execute(cmd));
    expect(results[0]).toHaveProperty('insertedCount', 2);
  });

  it('executes updateOne', async () => {
    await db.createCollection('items');
    await db.collection('items').insertOne({ name: 'alice', v: 1 });
    const driver = new MigrationMongoDriver(db);
    const cmd = new UpdateOneWireCommand('items', { name: 'alice' }, { $set: { v: 2 } });
    const results = await collect(driver.execute(cmd));
    expect(results[0]).toHaveProperty('modifiedCount', 1);
  });

  it('executes updateMany', async () => {
    await db.createCollection('items');
    await db.collection('items').insertMany([{ v: 1 }, { v: 1 }]);
    const driver = new MigrationMongoDriver(db);
    const cmd = new UpdateManyWireCommand('items', { v: 1 }, { $set: { v: 2 } });
    const results = await collect(driver.execute(cmd));
    expect(results[0]).toHaveProperty('modifiedCount', 2);
  });

  it('executes deleteOne', async () => {
    await db.createCollection('items');
    await db.collection('items').insertMany([{ x: 1 }, { x: 2 }]);
    const driver = new MigrationMongoDriver(db);
    const cmd = new DeleteOneWireCommand('items', { x: 1 });
    const results = await collect(driver.execute(cmd));
    expect(results[0]).toHaveProperty('deletedCount', 1);
  });

  it('executes deleteMany', async () => {
    await db.createCollection('items');
    await db.collection('items').insertMany([{ x: 1 }, { x: 1 }, { x: 2 }]);
    const driver = new MigrationMongoDriver(db);
    const cmd = new DeleteManyWireCommand('items', { x: 1 });
    const results = await collect(driver.execute(cmd));
    expect(results[0]).toHaveProperty('deletedCount', 2);
  });

  it('executes findOneAndUpdate', async () => {
    await db.createCollection('items');
    await db.collection('items').insertOne({ name: 'bob', v: 1 });
    const driver = new MigrationMongoDriver(db);
    const cmd = new FindOneAndUpdateWireCommand(
      'items',
      { name: 'bob' },
      { $set: { v: 2 } },
      false,
    );
    const results = await collect(driver.execute(cmd));
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('v', 2);
  });

  it('executes findOneAndDelete', async () => {
    await db.createCollection('items');
    await db.collection('items').insertOne({ name: 'charlie' });
    const driver = new MigrationMongoDriver(db);
    const cmd = new FindOneAndDeleteWireCommand('items', { name: 'charlie' });
    const results = await collect(driver.execute(cmd));
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('name', 'charlie');

    const remaining = await db.collection('items').countDocuments();
    expect(remaining).toBe(0);
  });

  it('executes aggregate', async () => {
    await db.createCollection('items');
    await db.collection('items').insertMany([{ v: 1 }, { v: 2 }, { v: 3 }]);
    const driver = new MigrationMongoDriver(db);
    const cmd = new AggregateWireCommand('items', [{ $match: { v: { $gte: 2 } } }]);
    const results = await collect(driver.execute(cmd));
    expect(results).toHaveLength(2);
  });

  it('close() is a no-op', async () => {
    const driver = new MigrationMongoDriver(db);
    await expect(driver.close()).resolves.toBeUndefined();
  });

  it('throws on unknown wire command kind', () => {
    const driver = new MigrationMongoDriver(db);
    // Cast is required to simulate a future wire kind not yet handled by the
    // dispatch. The runtime guard is paired with a compile-time `never` check
    // in `execute`'s default branch.
    const bogus = { kind: 'notARealKind' } as unknown as AnyMongoWireCommand;
    expect(() => driver.execute(bogus)).toThrow(/Unknown wire command kind: notARealKind/);
  });
});
