import {
  CreateIndexCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
} from '@prisma-next/mongo-query-ast/control';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoCommandExecutor, MongoInspectionExecutor } from '../src/core/command-executor';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'command_executor_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
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

describe('MongoCommandExecutor', () => {
  it('createIndex creates an index on a collection', async () => {
    await db.createCollection('users');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
      unique: true,
    });

    await cmd.accept(executor);

    const indexes = await db.collection('users').listIndexes().toArray();
    const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.['unique']).toBe(true);
  });

  it('dropIndex drops an existing index', async () => {
    await db.createCollection('posts');
    await db.collection('posts').createIndex({ title: 1 }, { name: 'title_1' });

    const executor = new MongoCommandExecutor(db);
    const cmd = new DropIndexCommand('posts', 'title_1');

    await cmd.accept(executor);

    const indexes = await db.collection('posts').listIndexes().toArray();
    const titleIndex = indexes.find((idx) => idx['name'] === 'title_1');
    expect(titleIndex).toBeUndefined();
  });
});

describe('MongoInspectionExecutor', () => {
  it('listIndexes returns index documents for a collection', async () => {
    await db.createCollection('items');
    await db.collection('items').createIndex({ sku: 1 });

    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListIndexesCommand('items');

    const results = await cmd.accept(executor);

    expect(results.length).toBeGreaterThanOrEqual(2);
    const skuIndex = results.find((doc) => doc['key']?.['sku'] === 1);
    expect(skuIndex).toBeDefined();
  });

  it('listCollections returns collection documents', async () => {
    await db.createCollection('alpha');
    await db.createCollection('beta');

    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListCollectionsCommand();

    const results = await cmd.accept(executor);

    const names = results.map((doc) => doc['name']);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });
});
