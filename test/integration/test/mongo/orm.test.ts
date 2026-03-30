import { validateMongoContract } from '@prisma-next/mongo-core';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/orm-contract';
import ormContractJson from './fixtures/orm-contract.json';
import { withMongod } from './setup';

const { contract } = validateMongoContract<Contract>(ormContractJson);

describe('mongoOrm integration', { timeout: timeouts.spinUpDbServer }, () => {
  it('findMany on a non-polymorphic root returns typed results', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      const users = db.collection('users');
      await users.insertMany([
        { name: 'Alice', email: 'alice@example.com', addresses: [] },
        { name: 'Bob', email: 'bob@example.com', addresses: [] },
      ]);

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const results = await orm.users.findMany();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
      expect(results[1]).toMatchObject({ name: 'Bob', email: 'bob@example.com' });
    });
  });

  it('findMany with equality filter narrows results', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('users').insertMany([
        { name: 'Alice', email: 'alice@example.com', addresses: [] },
        { name: 'Bob', email: 'bob@example.com', addresses: [] },
      ]);

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const results = await orm.users.findMany({
        where: { email: 'alice@example.com' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Alice' });
    });
  });

  it('include on a reference relation returns related docs via $lookup', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('users').insertOne({
        _id: 'u1' as never,
        name: 'Alice',
        email: 'alice@example.com',
        addresses: [],
      });
      await db.collection('tasks').insertOne({
        title: 'Fix bug',
        type: 'bug',
        assigneeId: 'u1',
        severity: 'high',
        comments: [],
      });

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const results = await orm.tasks.findMany({
        include: { assignee: true },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        title: 'Fix bug',
        assignee: { name: 'Alice', email: 'alice@example.com' },
      });
    });
  });

  it('embedded documents appear in default results without include', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('users').insertOne({
        name: 'Alice',
        email: 'alice@example.com',
        addresses: [
          { street: '123 Main St', city: 'Springfield', zip: '12345' },
          { street: '456 Oak Ave', city: 'Shelbyville', zip: '67890' },
        ],
      });

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const users = await orm.users.findMany();

      expect(users).toHaveLength(1);
      expect(users[0]!.addresses).toHaveLength(2);
      expect(users[0]!.addresses[0]).toMatchObject({
        street: '123 Main St',
        city: 'Springfield',
      });
    });
  });

  it('embedded comments appear on tasks without include', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('tasks').insertOne({
        title: 'Fix bug',
        type: 'bug',
        assigneeId: 'u1',
        severity: 'high',
        comments: [{ _id: 'c1', text: 'Found it!', createdAt: new Date('2025-01-01') }],
      });

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const tasks = await orm.tasks.findMany();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.comments).toHaveLength(1);
      expect(tasks[0]!.comments[0]).toMatchObject({ text: 'Found it!' });
    });
  });

  it('findMany on a polymorphic root returns all variants', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('tasks').insertMany([
        {
          title: 'Fix crash',
          type: 'bug',
          assigneeId: 'u1',
          severity: 'critical',
          comments: [],
        },
        {
          title: 'Add dark mode',
          type: 'feature',
          assigneeId: 'u1',
          priority: 'medium',
          targetRelease: 'v2.0',
          comments: [],
        },
      ]);

      const orm = mongoOrm({ contract, executor: ctx.runtime });
      const tasks = await orm.tasks.findMany();

      expect(tasks).toHaveLength(2);
      const bug = tasks.find((t) => t.type === 'bug');
      const feature = tasks.find((t) => t.type === 'feature');
      expect(bug).toMatchObject({ title: 'Fix crash', severity: 'critical' });
      expect(feature).toMatchObject({
        title: 'Add dark mode',
        priority: 'medium',
        targetRelease: 'v2.0',
      });
    });
  });

  it('full flow: ORM -> command -> runtime -> driver -> typed results', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('users').insertOne({
        _id: 'u1' as never,
        name: 'Alice',
        email: 'alice@example.com',
        addresses: [{ street: '123 Main', city: 'Town', zip: '00000' }],
      });
      await db.collection('tasks').insertOne({
        title: 'Ship it',
        type: 'feature',
        assigneeId: 'u1',
        priority: 'high',
        targetRelease: 'v1.0',
        comments: [{ _id: 'c1', text: 'LGTM', createdAt: new Date() }],
      });

      const orm = mongoOrm({ contract, executor: ctx.runtime });

      const users = await orm.users.findMany({ where: { name: 'Alice' } });
      expect(users).toHaveLength(1);
      expect(users[0]!.addresses).toHaveLength(1);

      const tasks = await orm.tasks.findMany({ include: { assignee: true } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        title: 'Ship it',
        assignee: { name: 'Alice' },
        comments: [{ text: 'LGTM' }],
      });
    });
  });
});
