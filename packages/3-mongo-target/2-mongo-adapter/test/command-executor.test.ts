import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
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

  it('createIndex passes expireAfterSeconds and sparse options', async () => {
    await db.createCollection('sessions');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand('sessions', [{ field: 'createdAt', direction: 1 }], {
      expireAfterSeconds: 3600,
      sparse: true,
    });

    await cmd.accept(executor);

    const indexes = await db.collection('sessions').listIndexes().toArray();
    const ttlIndex = indexes.find((idx) => idx['key']?.['createdAt'] === 1);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.['expireAfterSeconds']).toBe(3600);
    expect(ttlIndex?.['sparse']).toBe(true);
  });

  it('createIndex passes partialFilterExpression option', async () => {
    await db.createCollection('logs');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand('logs', [{ field: 'level', direction: 1 }], {
      partialFilterExpression: { active: true },
    });

    await cmd.accept(executor);

    const indexes = await db.collection('logs').listIndexes().toArray();
    const partialIndex = indexes.find((idx) => idx['key']?.['level'] === 1);
    expect(partialIndex).toBeDefined();
    expect(partialIndex?.['partialFilterExpression']).toEqual({ active: true });
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

  it('createIndex passes M2 options (collation, wildcardProjection)', async () => {
    await db.createCollection('products');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand('products', [{ field: 'name', direction: 1 }], {
      collation: { locale: 'en', strength: 2 },
    });

    await cmd.accept(executor);

    const indexes = await db.collection('products').listIndexes().toArray();
    const nameIndex = indexes.find((idx) => idx['key']?.['name'] === 1);
    expect(nameIndex).toBeDefined();
    expect(nameIndex?.['collation']?.['locale']).toBe('en');
  });

  it('createCollection creates a new collection', async () => {
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateCollectionCommand('events');

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'events' }).toArray();
    expect(colls).toHaveLength(1);
  });

  it('createCollection creates a capped collection', async () => {
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateCollectionCommand('logs', {
      capped: true,
      size: 1048576,
      max: 1000,
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'logs' }).toArray();
    expect(colls).toHaveLength(1);
    expect((colls[0] as Record<string, unknown>)['options']).toHaveProperty('capped', true);
  });

  it('dropCollection drops an existing collection', async () => {
    await db.createCollection('temp');
    const executor = new MongoCommandExecutor(db);
    const cmd = new DropCollectionCommand('temp');

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'temp' }).toArray();
    expect(colls).toHaveLength(0);
  });

  it('collMod updates validator on a collection', async () => {
    await db.createCollection('docs');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CollModCommand('docs', {
      validator: { $jsonSchema: { bsonType: 'object', required: ['name'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'docs' }).toArray();
    expect((colls[0] as Record<string, unknown>)['options']).toHaveProperty('validator');
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

  it('listIndexes returns empty array for non-existent collection', async () => {
    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListIndexesCommand('nonexistent_collection');

    const results = await cmd.accept(executor);
    expect(results).toEqual([]);
  });

  it('listIndexes re-throws non-NamespaceNotFound errors', async () => {
    const fakeDb = {
      collection: () => ({
        listIndexes: () => ({
          toArray: () => Promise.reject(new Error('connection lost')),
        }),
      }),
    } as unknown as Db;

    const executor = new MongoInspectionExecutor(fakeDb);
    const cmd = new ListIndexesCommand('any');

    await expect(cmd.accept(executor)).rejects.toThrow('connection lost');
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
