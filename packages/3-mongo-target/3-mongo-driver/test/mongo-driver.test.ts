import {
  AggregateWireCommand,
  CollModWireCommand,
  CreateCollectionWireCommand,
  CreateIndexWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  DropCollectionWireCommand,
  DropIndexWireCommand,
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
import { createMongoDriver, MongoDriverImpl } from '../src/mongo-driver';

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

    it('updates and returns the modified document when returnDocument=after', async () => {
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
          undefined,
          'after',
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Grace', age: 31 });
      } finally {
        await driver.close();
      }
    });

    it('upserts and returns the inserted document when returnDocument=after', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Heidi' },
          { $set: { age: 25 } },
          true,
          undefined,
          'after',
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

  describe('fromDb', () => {
    it('executes commands on a pre-built Db without owning the client', async () => {
      const db = seedClient.db(dbName);
      const col = 'driver_from_db';
      await db.collection(col).deleteMany({});

      const driver = MongoDriverImpl.fromDb(db);
      const cmd = new InsertOneWireCommand(col, { name: 'test' });
      const rows = await collect(driver.execute(cmd));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('insertedId');
    });

    it('close() is a no-op — does not close the external client', async () => {
      const driver = MongoDriverImpl.fromDb(seedClient.db(dbName));
      await expect(driver.close()).resolves.toBeUndefined();
      const pingResult = await seedClient.db(dbName).command({ ping: 1 });
      expect(pingResult).toMatchObject({ ok: 1 });
    });
  });

  describe('createCollection', () => {
    it('creates the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_col';

      await db.dropCollection(col).catch(() => undefined);

      await driver.run(new CreateCollectionWireCommand(col, {}));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col });
    });

    it('creates the collection with options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_col_opts';

      await db.dropCollection(col).catch(() => undefined);

      await driver.run(new CreateCollectionWireCommand(col, { capped: true, size: 1024 * 1024 }));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col, options: { capped: true, size: 1024 * 1024 } });
    });
  });

  describe('createIndex', () => {
    it('creates an index with a key spec', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_idx';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(new CreateIndexWireCommand(col, { email: 1 }, {}));

      const indexes = await db.collection(col).indexes();
      expect(indexes.some((idx) => Object.hasOwn(idx.key, 'email'))).toBe(true);
    });

    it('creates a unique index with options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_idx_opts';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(col, { username: 1 }, { unique: true, name: 'uniq_username' }),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'uniq_username');
      expect(idx).toBeDefined();
      expect(idx).toMatchObject({ unique: true, key: { username: 1 } });
    });
  });

  describe('dropCollection', () => {
    it('drops the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_drop_col';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(new DropCollectionWireCommand(col));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(0);
    });
  });

  describe('dropIndex', () => {
    it('drops a named index', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_drop_idx';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);
      await db.collection(col).createIndex({ score: 1 }, { name: 'score_idx' });

      await driver.run(new DropIndexWireCommand(col, 'score_idx'));

      const indexes = await db.collection(col).indexes();
      expect(indexes.every((idx) => idx.name !== 'score_idx')).toBe(true);
    });
  });

  describe('collMod', () => {
    it('applies collMod options to the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_collmod';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      const validator = { $jsonSchema: { bsonType: 'object' } };
      await driver.run(
        new CollModWireCommand(col, {
          validator,
          validationLevel: 'strict',
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        name: col,
        options: {
          validator,
          validationLevel: 'strict',
        },
      });
    });
  });

  describe('run() error propagation', () => {
    it('rejects when the server returns an error', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);

      await expect(
        driver.run(
          new CollModWireCommand('nonexistent_collection_xyz', { validationLevel: 'strict' }),
        ),
      ).rejects.toThrow();
    });
  });
});
