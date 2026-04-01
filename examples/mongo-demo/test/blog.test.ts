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

describe('mongo-demo task-tracker integration', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  const dbName = 'task_tracker_test';

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
    await db.collection('tasks').insertOne({
      title: 'Fix login bug',
      type: 'bug',
      severity: 'critical',
      assigneeId: 'u1',
      comments: [],
    });

    const orm = mongoOrm({ contract, executor: runtime });
    const tasks = await orm.tasks.findMany({
      include: { assignee: true },
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Fix login bug',
      type: 'bug',
      assignee: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('polymorphic tasks carry variant-specific fields', async () => {
    const db = client.db(dbName);
    await db.collection('tasks').insertMany([
      {
        title: 'Crash on startup',
        type: 'bug',
        severity: 'critical',
        assigneeId: 'u1',
        comments: [],
      },
      {
        title: 'Dark mode',
        type: 'feature',
        priority: 'high',
        targetRelease: 'v2.0',
        assigneeId: 'u1',
        comments: [],
      },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });
    const tasks = await orm.tasks.findMany();

    expect(tasks).toHaveLength(2);

    const bug = tasks.find((t) => t.type === 'bug');
    expect(bug).toMatchObject({ title: 'Crash on startup', severity: 'critical' });

    const feature = tasks.find((t) => t.type === 'feature');
    expect(feature).toMatchObject({ title: 'Dark mode', priority: 'high', targetRelease: 'v2.0' });
  });

  it('embedded comments appear in task results without include', async () => {
    const db = client.db(dbName);
    await db.collection('tasks').insertOne({
      title: 'Fix rendering',
      type: 'bug',
      severity: 'medium',
      assigneeId: 'u1',
      comments: [
        { _id: 'c1', text: 'Reproduces on Chrome', createdAt: new Date('2026-01-01') },
        { _id: 'c2', text: 'Root cause found', createdAt: new Date('2026-01-02') },
      ],
    });

    const orm = mongoOrm({ contract, executor: runtime });
    const tasks = await orm.tasks.findMany();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.comments).toHaveLength(2);
    expect(tasks[0]!.comments[0]).toMatchObject({ text: 'Reproduces on Chrome' });
    expect(tasks[0]!.comments[1]).toMatchObject({ text: 'Root cause found' });
  });

  it('full flow: seed -> query tasks with include, embeds, and polymorphism', async () => {
    const db = client.db(dbName);

    await db.collection('users').insertOne({
      _id: 'u1' as never,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [{ street: '456 Oak Ave', city: 'Portland', zip: '97201' }],
    });

    await db.collection('tasks').insertMany([
      {
        title: 'Memory leak',
        type: 'bug',
        severity: 'critical',
        assigneeId: 'u1',
        comments: [{ _id: 'c1', text: 'Heap grows 50MB/hour', createdAt: new Date('2026-03-25') }],
      },
      {
        title: 'CSV export',
        type: 'feature',
        priority: 'medium',
        targetRelease: 'v2.2',
        assigneeId: 'u1',
        comments: [],
      },
    ]);

    const orm = mongoOrm({ contract, executor: runtime });

    const users = await orm.users.findMany({ where: { name: 'Alice' } });
    expect(users).toHaveLength(1);
    expect(users[0]!.addresses).toHaveLength(1);

    const tasks = await orm.tasks.findMany({ include: { assignee: true } });
    expect(tasks).toHaveLength(2);

    const bugTask = tasks.find((t) => t.type === 'bug');
    expect(bugTask).toMatchObject({
      title: 'Memory leak',
      assignee: { name: 'Alice' },
      comments: [{ text: 'Heap grows 50MB/hour' }],
    });

    const featureTask = tasks.find((t) => t.type === 'feature');
    expect(featureTask).toMatchObject({
      title: 'CSV export',
      assignee: { name: 'Alice' },
    });
  });
});
