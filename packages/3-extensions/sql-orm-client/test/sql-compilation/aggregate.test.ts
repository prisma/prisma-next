import { describe, expect, it } from 'vitest';
import { createCollectionFor } from '../collection-fixtures';

describe('sql-compilation/aggregate', () => {
  it('aggregate() compiles count(*) with where filters', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ count: '2' }]]);

    const stats = await collection.where({ name: 'Alice' }).aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    expect(stats).toEqual({ count: 2 });
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('count(*)');
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('where');
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
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('sum("posts"."views")');
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('avg("posts"."views")');
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('min("posts"."views")');
    expect(runtime.executions[0]?.plan.sql.toLowerCase()).toContain('max("posts"."views")');
  });
});
