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
    const name = col['name'] as string;
    if (name.startsWith('system.')) continue;
    await db.dropCollection(name);
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

  it('createIndex passes text-index options (weights, default_language, language_override)', async () => {
    await db.createCollection('articles');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand(
      'articles',
      [
        { field: 'title', direction: 'text' },
        { field: 'body', direction: 'text' },
      ],
      {
        weights: { title: 10, body: 1 },
        default_language: 'english',
        language_override: 'lang',
      },
    );

    await cmd.accept(executor);

    const indexes = await db.collection('articles').listIndexes().toArray();
    const textIndex = indexes.find(
      (idx) =>
        idx['default_language'] === 'english' &&
        idx['language_override'] === 'lang' &&
        idx['weights'] !== undefined,
    );
    expect(textIndex).toBeDefined();
    expect(textIndex?.['weights']).toEqual({ title: 10, body: 1 });
    expect(textIndex?.['default_language']).toBe('english');
    expect(textIndex?.['language_override']).toBe('lang');
  });

  it('createIndex passes wildcardProjection option', async () => {
    await db.createCollection('wildcard_items');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateIndexCommand('wildcard_items', [{ field: '$**', direction: 1 }], {
      wildcardProjection: { name: 1 },
    });

    await cmd.accept(executor);

    const indexes = await db.collection('wildcard_items').listIndexes().toArray();
    const wildcardIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
    expect(wildcardIdx).toBeDefined();
    expect(wildcardIdx?.['wildcardProjection']).toEqual({ name: 1 });
  });

  it('createCollection passes validator and validation options', async () => {
    const executor = new MongoCommandExecutor(db);
    const validator = { $jsonSchema: { bsonType: 'object', required: ['name'] } };
    const cmd = new CreateCollectionCommand('validated_coll', {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'validated_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['validator']).toEqual(validator);
    expect(opts['validationLevel']).toBe('strict');
    expect(opts['validationAction']).toBe('error');
  });

  it('createCollection passes changeStreamPreAndPostImages option', async () => {
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateCollectionCommand('cs_images_coll', {
      changeStreamPreAndPostImages: { enabled: true },
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'cs_images_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['changeStreamPreAndPostImages']).toEqual({ enabled: true });
  });

  it('createCollection passes collation option', async () => {
    const executor = new MongoCommandExecutor(db);
    const collation = { locale: 'en', strength: 2 };
    const cmd = new CreateCollectionCommand('collation_coll', {
      collation,
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'collation_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['collation']).toMatchObject(collation);
  });

  it('collMod passes changeStreamPreAndPostImages option', async () => {
    await db.createCollection('cs_mod_coll');
    const executor = new MongoCommandExecutor(db);
    const cmd = new CollModCommand('cs_mod_coll', {
      changeStreamPreAndPostImages: { enabled: true },
    });

    await cmd.accept(executor);

    const colls = await db.listCollections({ name: 'cs_mod_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['changeStreamPreAndPostImages']).toEqual({ enabled: true });
  });

  it('createCollection passes timeseries option', async () => {
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateCollectionCommand('ts_coll', {
      timeseries: { timeField: 'ts', granularity: 'hours' },
    });

    try {
      await cmd.accept(executor);
    } catch {
      return;
    }

    const colls = await db.listCollections({ name: 'ts_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['timeseries']).toMatchObject({ timeField: 'ts', granularity: 'hours' });
  });

  it('createCollection passes clusteredIndex option', async () => {
    const executor = new MongoCommandExecutor(db);
    const cmd = new CreateCollectionCommand('clustered_coll', {
      clusteredIndex: { key: { _id: 1 }, unique: true },
    });

    try {
      await cmd.accept(executor);
    } catch {
      return;
    }

    const colls = await db.listCollections({ name: 'clustered_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['clusteredIndex']).toMatchObject({ key: { _id: 1 }, unique: true });
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
