import { describe, expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';
import { createTestContract } from './helpers';

describe('GroupedCollection', () => {
  it('groupBy().aggregate() maps grouped columns back to model fields', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    expect(rows).toEqual([{ userId: 1, count: 2 }]);
  });

  it('having() compiles aggregate predicates into HAVING clauses', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, totalViews: '50' }]]);

    const numericField = 'views' as never;
    const rows = await collection
      .groupBy('userId')
      .having((having) => having.count().gte(1))
      .aggregate((aggregate) => ({
        totalViews: aggregate.sum(numericField),
      }));

    expect(rows).toEqual([{ userId: 1, totalViews: 50 }]);
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('having count(*) >=');
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('sum("posts"."views")');
  });

  it('groupBy().aggregate() validates selector shape and non-empty spec', async () => {
    const { collection } = createCollectionFor('Post');

    await expect(collection.groupBy('userId').aggregate(() => ({}))).rejects.toThrow(
      /requires at least one aggregation selector/,
    );

    await expect(
      collection
        .groupBy('userId')
        .aggregate(() => ({ invalid: { kind: 'unknown', fn: 'count' } as never })),
    ).rejects.toThrow(/selector "invalid" is invalid/);
  });

  it('groupBy().having() supports all metrics and comparison operators', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
    ]);

    const numericField = 'views' as never;

    await collection
      .groupBy('userId')
      .having((having) => having.sum(numericField).eq(20))
      .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.avg(numericField).neq(99))
      .aggregate((aggregate) => ({ avg: aggregate.avg(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.min(numericField).gt(4))
      .aggregate((aggregate) => ({ min: aggregate.min(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.max(numericField).lt(99))
      .aggregate((aggregate) => ({ max: aggregate.max(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.count().gte(2))
      .aggregate((aggregate) => ({ count: aggregate.count() }));
    await collection
      .groupBy('userId')
      .having((having) => having.count().lte(2))
      .aggregate((aggregate) => ({ count: aggregate.count() }));

    const sqls = runtime.executions.map((entry) => entry.plan.sql.toLowerCase()).join('\n');
    expect(sqls).toContain('sum("posts"."views") =');
    expect(sqls).toContain('avg("posts"."views") !=');
    expect(sqls).toContain('min("posts"."views") >');
    expect(sqls).toContain('max("posts"."views") <');
    expect(sqls).toContain('count(*) >=');
    expect(sqls).toContain('count(*) <=');
  });

  it('groupBy().aggregate() coerces aggregate value types from runtime rows', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([
      [
        {
          user_id: 1,
          count: undefined,
          total: 10n,
          max: 'not-a-number',
        },
      ],
    ]);

    const numericField = 'views' as never;
    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.count(),
      total: aggregate.sum(numericField),
      max: aggregate.max(numericField),
    }));

    expect(rows).toEqual([{ userId: 1, count: 0, total: 10, max: 'not-a-number' }]);
  });

  it('groupBy().aggregate() coerces null, numeric, undefined, and object aggregate values', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([
      [
        {
          user_id: 1,
          count: null,
          total: 5,
          avg: undefined,
          max: { raw: true },
        },
      ],
    ]);

    const numericField = 'views' as never;
    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.count(),
      total: aggregate.sum(numericField),
      avg: aggregate.avg(numericField),
      max: aggregate.max(numericField),
    }));

    expect(rows).toEqual([
      {
        userId: 1,
        count: null,
        total: 5,
        avg: null,
        max: { raw: true },
      },
    ]);
  });

  it('groupBy().having() falls back to raw field names when field mappings are missing', async () => {
    const contract = createTestContract();
    const { collection, runtime } = createCollectionFor('Post', {
      ...contract,
      mappings: {
        ...contract.mappings,
        fieldToColumn: {},
      },
    } as never);
    runtime.setNextResults([
      [{ id: 1, total: '5' }],
      [{ id: 1, avg: '5' }],
      [{ id: 1, min: '5' }],
      [{ id: 1, max: '5' }],
    ]);

    const numericField = 'userId' as never;
    await collection
      .groupBy('id')
      .having((having) => having.sum(numericField).gt(1))
      .aggregate((aggregate) => ({
        total: aggregate.sum(numericField),
      }));
    await collection
      .groupBy('id')
      .having((having) => having.avg(numericField).gt(1))
      .aggregate((aggregate) => ({
        avg: aggregate.avg(numericField),
      }));
    await collection
      .groupBy('id')
      .having((having) => having.min(numericField).gt(1))
      .aggregate((aggregate) => ({
        min: aggregate.min(numericField),
      }));
    await collection
      .groupBy('id')
      .having((having) => having.max(numericField).gt(1))
      .aggregate((aggregate) => ({
        max: aggregate.max(numericField),
      }));

    const sql = runtime.executions.map((entry) => entry.plan.sql.toLowerCase()).join('\n');
    expect(sql).toContain('sum("posts"."userid")');
    expect(sql).toContain('avg("posts"."userid")');
    expect(sql).toContain('min("posts"."userid")');
    expect(sql).toContain('max("posts"."userid")');
  });

  it('only exposes grouped operations at runtime', () => {
    const { collection } = createCollectionFor('Post');
    const grouped = collection.groupBy('userId') as unknown as Record<string, unknown>;

    expect(typeof grouped['having']).toBe('function');
    expect(typeof grouped['aggregate']).toBe('function');
    expect(grouped['all']).toBeUndefined();
    expect(grouped['first']).toBeUndefined();
    expect(grouped['include']).toBeUndefined();
    expect(grouped['select']).toBeUndefined();
  });
});
