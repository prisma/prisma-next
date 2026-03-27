import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: subqueries', () => {
  const { db } = setupIntegrationTest();

  it('EXISTS filters to rows with matching subquery', async () => {
    const d = db();
    const rows = await collect(
      d.users
        .select('id', 'name')
        .where((f, fns) =>
          fns.exists(
            d.posts.select('id').where((pf, pfns) => pfns.eq(pf.posts.user_id, f.users.id)),
          ),
        )
        .orderBy('id')
        .all(),
    );
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('subquery as join source', async () => {
    const d = db();
    const sub = d.posts.select('user_id', 'title').as('sub');
    const rows = await collect(
      d.users
        .innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id))
        .select('name', 'title')
        .all(),
    );
    expect(rows.length).toBe(4);
  });
});
