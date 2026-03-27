import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: extension functions', () => {
  const { db } = setupIntegrationTest();

  it('cosineDistance computes similarity for identical vectors', async () => {
    const row = await db()
      .posts.select('id')
      .select('similarity', (f, fns) => fns.cosineDistance(f.embedding, [1, 0, 0]))
      .where((f, fns) => fns.eq(f.id, 1))
      .first();
    expect(row).not.toBeNull();
    // template: 1 - (self <=> arg0), identical vectors → 1 - 0 = 1
    expect(row!.similarity).toBeCloseTo(1, 5);
  });

  it('cosineDistance filters in WHERE', async () => {
    // post 1 has embedding [1,0,0] → similarity to [1,0,0] is 1.0
    // post 3 has embedding [0,0,1] → similarity to [1,0,0] is ~0 (orthogonal)
    const rows = await collect(
      db()
        .posts.select('id')
        .where((f, fns) => fns.gt(fns.cosineDistance(f.embedding, [1, 0, 0]), 0.5))
        .all(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === 1)).toBe(true);
  });
});
