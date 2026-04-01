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

  it('findMany returns seeded users', async () => {
    const db = client.db(dbName);
    await db.collection('users').insertMany([
      { _id: 'u1' as never, name: 'Alice', email: 'alice@example.com', bio: 'Writer' },
      { _id: 'u2' as never, name: 'Bob', email: 'bob@example.com', bio: null },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });
    const users = await orm.users.findMany();

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com', bio: 'Writer' });
    expect(users[1]).toMatchObject({ name: 'Bob', email: 'bob@example.com', bio: null });
  });

  it('findMany returns seeded posts', async () => {
    const db = client.db(dbName);
    await db.collection('users').insertOne({
      _id: 'u1' as never,
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
    });
    await db.collection('posts').insertMany([
      {
        _id: 'p1' as never,
        title: 'Hello World',
        content: 'My first post',
        authorId: 'u1',
        createdAt: new Date('2026-01-15'),
      },
      {
        _id: 'p2' as never,
        title: 'Second Post',
        content: 'More content',
        authorId: 'u1',
        createdAt: new Date('2026-02-01'),
      },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });
    const posts = await orm.posts.findMany();

    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ title: 'Hello World', content: 'My first post' });
    expect(posts[1]).toMatchObject({ title: 'Second Post', content: 'More content' });
  });

  it('findMany with include resolves Post -> User via $lookup', async () => {
    const db = client.db(dbName);
    await db.collection('users').insertOne({
      _id: 'u1' as never,
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
    });
    await db.collection('posts').insertOne({
      _id: 'p1' as never,
      title: 'Hello World',
      content: 'My first post',
      authorId: 'u1',
      createdAt: new Date('2026-01-15'),
    });

    const orm = mongoOrm({ contract, executor: runtime });
    const posts = await orm.posts.findMany({ include: { author: true } });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('full flow: seed users and posts, query with include', async () => {
    const db = client.db(dbName);

    await db.collection('users').insertMany([
      { _id: 'u1' as never, name: 'Alice', email: 'alice@example.com', bio: 'Writer' },
      { _id: 'u2' as never, name: 'Bob', email: 'bob@example.com', bio: null },
    ]);

    await db.collection('posts').insertMany([
      {
        _id: 'p1' as never,
        title: 'Hello World',
        content: 'My first post',
        authorId: 'u1',
        createdAt: new Date('2026-01-15'),
      },
      {
        _id: 'p2' as never,
        title: 'Mongo with Prisma Next',
        content: 'Using the contract-first approach',
        authorId: 'u2',
        createdAt: new Date('2026-02-20'),
      },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });

    const users = await orm.users.findMany();
    expect(users).toHaveLength(2);

    const posts = await orm.posts.findMany({ include: { author: true } });
    expect(posts).toHaveLength(2);

    const alicePost = posts.find((p) => p.authorId === 'u1');
    expect(alicePost).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice' },
    });

    const bobPost = posts.find((p) => p.authorId === 'u2');
    expect(bobPost).toMatchObject({
      title: 'Mongo with Prisma Next',
      author: { name: 'Bob' },
    });
  });
});
