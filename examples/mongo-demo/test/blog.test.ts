import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type { MongoLoweringContext } from '@prisma-next/mongo-core';
import { validateMongoContract } from '@prisma-next/mongo-core';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);

describe('mongo-demo blog integration', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  const dbName = 'blog_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    const adapter = createMongoAdapter();
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    const loweringContext: MongoLoweringContext = { contract };
    runtime = createMongoRuntime({ adapter, driver, loweringContext });
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    try {
      await runtime?.close();
      await client?.close();
      await replSet?.stop();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpDbServer);

  it('findMany returns seeded users with embedded addresses', async () => {
    const db = client.db(dbName);
    await db.collection('users').insertMany([
      {
        _id: 'u1' as never,
        name: 'Alice',
        email: 'alice@example.com',
        addresses: [{ street: '123 Main St', city: 'Springfield', zip: '12345' }],
      },
      {
        _id: 'u2' as never,
        name: 'Bob',
        email: 'bob@example.com',
        addresses: [],
      },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });
    const users = await orm.users.findMany();

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(users[0]!.addresses).toHaveLength(1);
    expect(users[0]!.addresses[0]).toMatchObject({ street: '123 Main St', city: 'Springfield' });
    expect(users[1]).toMatchObject({ name: 'Bob', addresses: [] });
  });

  it('findMany with include resolves reference relations via $lookup', async () => {
    const db = client.db(dbName);
    await db.collection('users').insertOne({
      _id: 'u1' as never,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [],
    });
    await db.collection('posts').insertOne({
      title: 'Hello World',
      content: 'First post!',
      authorId: 'u1',
      createdAt: new Date('2025-01-01'),
      comments: [],
    });

    const orm = mongoOrm({ contract, executor: runtime });
    const posts = await orm.posts.findMany({
      include: { author: true },
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('embedded comments appear in post results without include', async () => {
    const db = client.db(dbName);
    await db.collection('posts').insertOne({
      title: 'Test Post',
      content: 'Content here',
      authorId: 'u1',
      createdAt: new Date('2025-01-01'),
      comments: [
        { text: 'Great post!', createdAt: new Date('2025-01-02') },
        { text: 'Thanks!', createdAt: new Date('2025-01-03') },
      ],
    });

    const orm = mongoOrm({ contract, executor: runtime });
    const posts = await orm.posts.findMany();

    expect(posts).toHaveLength(1);
    expect(posts[0]!.comments).toHaveLength(2);
    expect(posts[0]!.comments[0]).toMatchObject({ text: 'Great post!' });
    expect(posts[0]!.comments[1]).toMatchObject({ text: 'Thanks!' });
  });

  it('full flow: seed -> query users, posts with include and embeds', async () => {
    const db = client.db(dbName);

    await db.collection('users').insertOne({
      _id: 'u1' as never,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [{ street: '456 Oak Ave', city: 'Portland', zip: '97201' }],
    });

    await db.collection('posts').insertOne({
      title: 'Getting Started',
      content: 'A guide to the blog',
      authorId: 'u1',
      createdAt: new Date('2025-06-01'),
      comments: [{ text: 'Very helpful', createdAt: new Date('2025-06-02') }],
    });

    const orm = mongoOrm({ contract, executor: runtime });

    const users = await orm.users.findMany({ where: { name: 'Alice' } });
    expect(users).toHaveLength(1);
    expect(users[0]!.addresses).toHaveLength(1);

    const posts = await orm.posts.findMany({ include: { author: true } });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Getting Started',
      author: { name: 'Alice' },
      comments: [{ text: 'Very helpful' }],
    });
  });
});
