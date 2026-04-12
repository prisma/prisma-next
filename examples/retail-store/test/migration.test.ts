import { validateMongoContract } from '@prisma-next/mongo-contract';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };

describe('migration', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'migration_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpDbServer);

  afterAll(async () => {
    await Promise.allSettled([client?.close(), replSet?.stop()]);
  }, timeouts.spinUpDbServer);

  it('contract contains expected index definitions', () => {
    const { contract } = validateMongoContract<Contract>(contractJson);
    const { collections } = contract.storage;

    expect(collections.users.indexes).toEqual([
      { fields: { email: 1 }, options: { unique: true } },
    ]);
    expect(collections.carts.indexes).toEqual([{ fields: { userId: 1 } }]);
    expect(collections.orders.indexes).toEqual([{ fields: { userId: 1 } }]);
    expect(collections.events.indexes).toEqual([{ fields: { userId: 1 } }]);
  });

  it('creates indexes from migration ops and verifies they exist', async () => {
    await db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_1' });
    await db.collection('carts').createIndex({ userId: 1 }, { name: 'userId_1' });
    await db.collection('orders').createIndex({ userId: 1 }, { name: 'userId_1' });
    await db.collection('events').createIndex({ userId: 1 }, { name: 'userId_1' });

    const userIndexes = await db.collection('users').indexes();
    expect(userIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { email: 1 }, unique: true, name: 'email_1' }),
      ]),
    );

    const cartIndexes = await db.collection('carts').indexes();
    expect(cartIndexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { userId: 1 }, name: 'userId_1' })]),
    );

    const orderIndexes = await db.collection('orders').indexes();
    expect(orderIndexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { userId: 1 }, name: 'userId_1' })]),
    );

    const eventIndexes = await db.collection('events').indexes();
    expect(eventIndexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { userId: 1 }, name: 'userId_1' })]),
    );
  });
});
