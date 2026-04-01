import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: GROUP BY / HAVING', () => {
  const { db } = setupIntegrationTest();

  it('GROUP BY with COUNT', async () => {
    const rows = await collect(
      db()
        .posts.select('user_id')
        .select('cnt', (_f, fns) => fns.count())
        .groupBy('user_id')
        .orderBy('user_id')
        .all(),
    );
    expect(rows.length).toBeGreaterThan(0);
    const alice = rows.find((r) => r.user_id === 1);
    expect(alice!.cnt).toBe('2');
  });

  it('HAVING filters groups', async () => {
    const rows = await collect(
      db()
        .posts.select('user_id')
        .select('cnt', (_f, fns) => fns.count())
        .groupBy('user_id')
        .having((_f, fns) => fns.gt(fns.count(), 1))
        .all(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(1);
  });
});
