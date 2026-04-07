import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { AggregateCommand } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { acc } from '../../5-query-builders/pipeline-builder/src/accumulator-helpers';
import { fn } from '../../5-query-builders/pipeline-builder/src/expression-helpers';
import { mongoPipeline } from '../../5-query-builders/pipeline-builder/src/pipeline';
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

describe('pipeline builder integration', () => {
  const p = mongoPipeline<TContract>({ contractJson });

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

      expect(plan.meta.lane).toBe('mongo-pipeline');
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number; orderCount: number }>;
      expect(typed[0]).toMatchObject({ _id: 'sales', total: 450 });
      expect(typed[1]).toMatchObject({ _id: 'eng', total: 300 });
    });
  });

  it('addFields → match on computed field', async () => {
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

      const typed = rows as Array<{ department: string; amount: number }>;
      expect(typed[0]?.amount).toBe(200);
      expect(typed[1]?.amount).toBe(100);
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
});
