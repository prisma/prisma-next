import {
  AggregateWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoDriver } from '../src/mongo-driver';

let replSet: MongoMemoryReplSet;
let connectionUri: string;
let seedClient: MongoClient;
const dbName = 'driver_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  connectionUri = replSet.getUri();
  seedClient = new MongoClient(connectionUri);
  await seedClient.connect();
});

afterAll(async () => {
  await seedClient?.close();
  await replSet?.stop();
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('MongoDriver', () => {
  describe('insertOne', () => {
    const col = 'driver_insert';

    it('inserts and returns insertedId', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new InsertOneWireCommand(col, { name: 'Dave', age: 28 });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveProperty('insertedId');
      } finally {
        await driver.close();
      }
    });
  });

  describe('updateOne', () => {
    const col = 'driver_update';

    it('updates and returns matched/modified counts', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Eve', age: 22 });

        const cmd = new UpdateOneWireCommand(col, { name: 'Eve' }, { $set: { age: 23 } });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('deleteOne', () => {
    const col = 'driver_delete';

    it('deletes and returns deletedCount', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Frank' });

        const cmd = new DeleteOneWireCommand(col, { name: 'Frank' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ deletedCount: 1 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('insertMany', () => {
    const col = 'driver_insert_many';

    it('inserts multiple documents and returns ids', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new InsertManyWireCommand(col, [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ]);
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ insertedCount: 2 });
        expect((rows[0] as { insertedIds: unknown[] }).insertedIds).toHaveLength(2);
      } finally {
        await driver.close();
      }
    });
  });

  describe('updateMany', () => {
    const col = 'driver_update_many';

    it('updates multiple documents and returns counts', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertMany([
          { status: 'active', name: 'A' },
          { status: 'active', name: 'B' },
          { status: 'inactive', name: 'C' },
        ]);

        const cmd = new UpdateManyWireCommand(
          col,
          { status: 'active' },
          { $set: { status: 'archived' } },
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('deleteMany', () => {
    const col = 'driver_delete_many';

    it('deletes multiple documents and returns count', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db
          .collection(col)
          .insertMany([{ status: 'old' }, { status: 'old' }, { status: 'new' }]);

        const cmd = new DeleteManyWireCommand(col, { status: 'old' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ deletedCount: 2 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('findOneAndUpdate', () => {
    const col = 'driver_find_update';

    it('updates and returns the modified document', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Grace', age: 30 });

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Grace' },
          { $set: { age: 31 } },
          false,
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Grace', age: 31 });
      } finally {
        await driver.close();
      }
    });

    it('upserts when document does not exist', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Heidi' },
          { $set: { age: 25 } },
          true,
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Heidi', age: 25 });
      } finally {
        await driver.close();
      }
    });

    it('yields nothing when no match and upsert is false', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Nobody' },
          { $set: { age: 99 } },
          false,
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(0);
      } finally {
        await driver.close();
      }
    });
  });

  describe('findOneAndDelete', () => {
    const col = 'driver_find_delete';

    it('deletes and returns the removed document', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Ivan', age: 40 });

        const cmd = new FindOneAndDeleteWireCommand(col, { name: 'Ivan' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Ivan', age: 40 });
      } finally {
        await driver.close();
      }
    });

    it('yields nothing when no match', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndDeleteWireCommand(col, { name: 'Nobody' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(0);
      } finally {
        await driver.close();
      }
    });
  });

  describe('aggregate', () => {
    const col = 'driver_aggregate';

    it('runs pipeline and returns results', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertMany([
          { dept: 'eng', amount: 100 },
          { dept: 'eng', amount: 200 },
          { dept: 'sales', amount: 50 },
        ]);

        const cmd = new AggregateWireCommand(col, [
          { $group: { _id: '$dept', total: { $sum: '$amount' } } },
          { $sort: { _id: 1 } },
        ]);
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ _id: 'eng', total: 300 });
        expect(rows[1]).toMatchObject({ _id: 'sales', total: 50 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('close', () => {
    it('closes without error', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      await expect(driver.close()).resolves.toBeUndefined();
    });
  });
});
