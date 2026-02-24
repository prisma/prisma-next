import { describe, expect, it } from 'vitest';
import { createCollectionFor } from '../collection-fixtures';
import { normalizeSql } from './helpers';

describe('sql-compilation/aggregate', () => {
  it('aggregate() compiles count(*) with where filters', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ count: '2' }]]);

    const stats = await collection.where({ name: 'Alice' }).aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    expect(stats).toEqual({ count: 2 });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select count(*) as "count" from "users" where "users"."name" = $1',
    );
  });

  it('aggregate() compiles sum/avg/min/max selectors against mapped columns', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ total: '60', avg: '20', min: 10, max: 30 }]]);
    const numericField = 'views' as never;

    const stats = await collection.aggregate((aggregate) => ({
      total: aggregate.sum(numericField),
      avg: aggregate.avg(numericField),
      min: aggregate.min(numericField),
      max: aggregate.max(numericField),
    }));

    expect(stats).toEqual({
      total: 60,
      avg: 20,
      min: 10,
      max: 30,
    });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select sum("posts"."views") as "total", avg("posts"."views") as "avg", min("posts"."views") as "min", max("posts"."views") as "max" from "posts"',
    );
  });
});
