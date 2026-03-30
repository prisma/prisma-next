import { AggregateCommand } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('aggregate integration', () => {
  const collectionName = 'aggregate_test_orders';

  it('runs a $group aggregation pipeline', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { department: 'eng', amount: 100 },
        { department: 'eng', amount: 200 },
        { department: 'sales', amount: 150 },
      ]);

      const plan = ctx.makePlan(
        new AggregateCommand(collectionName, [
          { $group: { _id: '$department', total: { $sum: '$amount' } } },
          { $sort: { _id: 1 } },
        ]),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number }>;
      expect(typed[0]).toMatchObject({ _id: 'eng', total: 300 });
      expect(typed[1]).toMatchObject({ _id: 'sales', total: 150 });
    });
  });
});
