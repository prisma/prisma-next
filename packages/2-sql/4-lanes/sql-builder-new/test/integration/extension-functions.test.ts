import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: extension functions', () => {
  const { db } = setupIntegrationTest();

  it('cosineDistance computes distance for identical vectors', async () => {
    const row = await db()
      .posts.select('id')
      .select('distance', (f, fns) => fns.cosineDistance(f.embedding, [1, 0, 0]))
      .where((f, fns) => fns.eq(f.id, 1))
      .first();
    expect(row).not.toBeNull();
    // template: self <=> arg0, identical vectors → distance = 0
    expect(row!.distance).toBeCloseTo(0, 5);
  });

  it('cosineDistance filters in WHERE', async () => {
    // post 1 has embedding [1,0,0] → distance to [1,0,0] is 0.0
    // post 3 has embedding [0,0,1] → distance to [1,0,0] is ~1 (orthogonal)
    const rows = await collect(
      db()
        .posts.select('id')
        .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 0, 0]), 0.5))
        .all(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === 1)).toBe(true);
  });
});
