import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
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
    runtime = createMongoRuntime({ adapter, driver });
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpDbServer);

  it('all() returns seeded users', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: 'Writer' },
      { name: 'Bob', email: 'bob@example.com', bio: null },
    ]);

    const users = await orm.users.all();
    const sorted = [...users].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    expect(sorted).toHaveLength(2);
    expect(sorted[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com', bio: 'Writer' });
    expect(sorted[1]).toMatchObject({ name: 'Bob', email: 'bob@example.com', bio: null });
  });

  it('all() returns seeded posts', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
    });
    await orm.posts.createAll([
      {
        title: 'Hello World',
        content: 'My first post',
        authorId: alice._id as string,
        createdAt: new Date('2026-01-15'),
      },
      {
        title: 'Second Post',
        content: 'More content',
        authorId: alice._id as string,
        createdAt: new Date('2026-02-01'),
      },
    ]);

    const posts = await orm.posts.all();
    const sorted = [...posts].sort((a, b) => String(a.title).localeCompare(String(b.title)));

    expect(sorted).toHaveLength(2);
    expect(sorted[0]).toMatchObject({ title: 'Hello World', content: 'My first post' });
    expect(sorted[1]).toMatchObject({ title: 'Second Post', content: 'More content' });
  });

  it('include() resolves Post -> User via $lookup', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
    });
    await orm.posts.create({
      title: 'Hello World',
      content: 'My first post',
      authorId: alice._id as string,
      createdAt: new Date('2026-01-15'),
    });

    const posts = await orm.posts.include('author').all();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('full flow: seed users and posts, query with include', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    const createdUsers = await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: 'Writer' },
      { name: 'Bob', email: 'bob@example.com', bio: null },
    ]);
    const alice = createdUsers[0];
    const bob = createdUsers[1];
    if (!alice || !bob) throw new Error('Expected 2 users');

    await orm.posts.createAll([
      {
        title: 'Hello World',
        content: 'My first post',
        authorId: alice._id as string,
        createdAt: new Date('2026-01-15'),
      },
      {
        title: 'Mongo with Prisma Next',
        content: 'Using the contract-first approach',
        authorId: bob._id as string,
        createdAt: new Date('2026-02-20'),
      },
    ]);

    const users = await orm.users.all();
    expect(users).toHaveLength(2);

    const posts = await orm.posts.include('author').all();
    expect(posts).toHaveLength(2);

    const alicePost = posts.find((p) => String(p.authorId) === String(alice._id));
    expect(alicePost).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice' },
    });

    const bobPost = posts.find((p) => String(p.authorId) === String(bob._id));
    expect(bobPost).toMatchObject({
      title: 'Mongo with Prisma Next',
      author: { name: 'Bob' },
    });
  });
});
