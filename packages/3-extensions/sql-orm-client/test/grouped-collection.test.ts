import { describe, expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

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

  it('only exposes grouped operations at runtime', () => {
    const { collection } = createCollectionFor('Post');
    const grouped = collection.groupBy('userId') as unknown as Record<string, unknown>;

    expect(typeof grouped['having']).toBe('function');
    expect(typeof grouped['aggregate']).toBe('function');
    expect(grouped['all']).toBeUndefined();
    expect(grouped['find']).toBeUndefined();
    expect(grouped['include']).toBeUndefined();
    expect(grouped['select']).toBeUndefined();
  });
});
