import { AggregateCommand } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { getRuntime, makePlan } from './helpers';
import { getClient, getDbName } from './setup';

describe('aggregate integration', () => {
  const collectionName = 'aggregate_test_orders';

  beforeAll(async () => {
    const db = getClient().db(getDbName());
    const col = db.collection(collectionName);
    await col.deleteMany({});
    await col.insertMany([
      { department: 'eng', amount: 100 },
      { department: 'eng', amount: 200 },
      { department: 'sales', amount: 150 },
    ]);
  });

  it('runs a $group aggregation pipeline', async () => {
    const rt = await getRuntime();
    const plan = makePlan(
      new AggregateCommand(collectionName, [
        { $group: { _id: '$department', total: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
    );
    const rows = await rt.execute(plan);
    expect(rows).toHaveLength(2);

    const typed = rows as Array<{ _id: string; total: number }>;
    expect(typed[0]).toMatchObject({ _id: 'eng', total: 300 });
    expect(typed[1]).toMatchObject({ _id: 'sales', total: 150 });
  });
});
