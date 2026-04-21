import mongoFamilyPack from '@prisma-next/family-mongo/pack';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { defineContract, field, model, rel } from '@prisma-next/mongo-contract-ts/contract-builder';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { acc, fn, mongoQuery } from '@prisma-next/mongo-query-builder';
import mongoTargetPack from '@prisma-next/target-mongo/pack';
import { ObjectId } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { withMongod } from './setup';

type TestContract = MongoContract & {
  readonly models: {
    readonly Order: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly department: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly amount: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
        readonly status: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'orders' };
    };
    readonly User: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly firstName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly lastName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly orderId: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'users' };
    };
  };
  readonly roots: { readonly orders: 'Order'; readonly users: 'User' };
};

type TContract = MongoContractWithTypeMaps<TestContract, MongoTypeMaps>;
type PlanRow<TPlan> = TPlan extends MongoQueryPlan<infer Row> ? Row : never;

const contractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { orders: 'Order', users: 'User' },
  models: {
    Order: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        department: { codecId: 'mongo/string@1', nullable: false },
        amount: { codecId: 'mongo/double@1', nullable: false },
        status: { codecId: 'mongo/string@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'orders' },
    },
    User: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        firstName: { codecId: 'mongo/string@1', nullable: false },
        lastName: { codecId: 'mongo/string@1', nullable: false },
        orderId: { codecId: 'mongo/objectId@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: { storageHash: 'test-hash', collections: { orders: {}, users: {} } },
  capabilities: {},
  extensionPacks: {},
  profileHash: 'test-profile',
  meta: {},
};

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    name: field.string(),
    email: field.string(),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    _id: field.objectId(),
    title: field.string(),
    type: field.string(),
    assigneeId: field.objectId(),
  },
  relations: {
    assignee: rel.belongsTo(User, {
      from: 'assigneeId',
      to: User.ref('_id'),
    }),
  },
});

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { User, Task },
});

describe('pipeline builder integration', () => {
  const p = mongoQuery<TContract>({ contractJson });

  it('match → group → sort → limit analytics query', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'eng', amount: 50, status: 'pending' },
        { department: 'sales', amount: 150, status: 'completed' },
        { department: 'sales', amount: 300, status: 'completed' },
        { department: 'hr', amount: 75, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .match((f) => f.status.eq('completed'))
        .group((f) => ({
          _id: f.department,
          total: acc.sum(f.amount),
          orderCount: acc.count(),
        }))
        .sort({ total: -1 })
        .limit(2)
        .build();

      expect(plan.meta.lane).toBe('mongo-query');
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number; orderCount: number }>;
      expect(typed[0]).toMatchObject({ _id: 'sales', total: 450 });
      expect(typed[1]).toMatchObject({ _id: 'eng', total: 300 });
    });
  });

  it('addFields → assert computed field is present', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'sales', amount: 50, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .addFields((f) => ({
          isHighValue: fn.cond(
            fn.add(f.amount, fn.literal(0)).node,
            fn.literal<{ readonly codecId: 'mongo/bool@1'; readonly nullable: false }>(true),
            fn.literal<{ readonly codecId: 'mongo/bool@1'; readonly nullable: false }>(false),
          ),
        }))
        .sort({ amount: -1 })
        .limit(2)
        .build();

      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ department: string; amount: number; isHighValue: boolean }>;
      expect(typed[0]).toMatchObject({ amount: 200, isHighValue: true });
      expect(typed[1]).toMatchObject({ amount: 100, isHighValue: true });
    });
  });

  it('group with _id: null for whole-collection aggregation', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'sales', amount: 300, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .group((_f) => ({
          _id: null,
          totalRevenue: acc.sum(_f.amount),
          count: acc.count(),
        }))
        .build();

      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(1);

      const typed = rows as Array<{ _id: null; totalRevenue: number; count: number }>;
      expect(typed[0]).toMatchObject({ _id: null, totalRevenue: 600, count: 3 });
    });
  });

  it('lookup → unwind → project joins and flattens', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      const orderId = (
        await db
          .collection('orders')
          .insertOne({ department: 'eng', amount: 500, status: 'completed' })
      ).insertedId;
      await db.collection('users').insertMany([
        { firstName: 'Alice', lastName: 'A', orderId },
        { firstName: 'Bob', lastName: 'B', orderId },
      ]);

      const plan = p
        .from('orders')
        .lookup({ from: 'users', localField: '_id', foreignField: 'orderId', as: 'assignees' })
        .unwind('assignees')
        .project((f) => ({
          department: 1 as const,
          assignee: f.assignees,
        }))
        .build();

      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<Record<string, unknown>>;
      expect(typed[0]).toHaveProperty('department', 'eng');
      expect(typed[0]).toHaveProperty('assignee');
      expect(typed[1]).toHaveProperty('department', 'eng');
    });
  });

  it('project narrows to selected fields', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'sales', amount: 200, status: 'pending' },
      ]);

      const plan = p.from('orders').project('department', 'amount').sort({ amount: 1 }).build();

      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<Record<string, unknown>>;
      expect(typed[0]).toHaveProperty('department', 'eng');
      expect(typed[0]).toHaveProperty('amount', 100);
      expect(typed[0]).not.toHaveProperty('status');
    });
  });

  it('executes with a builder-authored contract directly', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      const userId = new ObjectId();

      await db.collection('users').insertOne({
        _id: userId,
        name: 'Alice',
        email: 'alice@example.com',
      });
      await db.collection('tasks').insertMany([
        {
          _id: new ObjectId(),
          title: 'Fix crash',
          type: 'bug',
          assigneeId: userId,
        },
        {
          _id: new ObjectId(),
          title: 'Fix typo',
          type: 'bug',
          assigneeId: userId,
        },
      ]);

      const plan = mongoQuery<typeof contract>({ contractJson: contract })
        .from('tasks')
        .group((f) => ({
          _id: f.type,
          count: acc.count(),
        }))
        .build();

      expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
        _id: string;
        count: number;
      }>();

      const results = await ctx.runtime.execute(plan);

      expect(results).toEqual([
        {
          _id: 'bug',
          count: 2,
        },
      ]);
    });
  });
});
