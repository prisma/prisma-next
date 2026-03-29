import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  FindWireCommand,
  InsertOneWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';
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
  describe('find', () => {
    const col = 'driver_find';

    beforeAll(async () => {
      const db = seedClient.db(dbName);
      await db.collection(col).deleteMany({});
      await db.collection(col).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ]);
    });

    it('returns matching documents', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new FindWireCommand(col, { name: 'Alice' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Alice', age: 30 });
      } finally {
        await driver.close();
      }
    });

    it('applies projection, sort, limit, skip', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new FindWireCommand(
          col,
          {},
          {
            projection: { name: 1, _id: 0 },
            sort: { name: 1 },
            limit: 2,
            skip: 1,
          },
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ name: 'Bob' });
        expect(rows[1]).toEqual({ name: 'Charlie' });
      } finally {
        await driver.close();
      }
    });
  });

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
