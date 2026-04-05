import { describe, expect, it } from 'vitest';
import { setupIntegrationTest } from './setup';

describe('integration: arithmetic operations', () => {
  const { db, runtime } = setupIntegrationTest();

  it('add computes column + literal', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('viewsPlus', (f, fns) => fns.add(f.views, 10))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.viewsPlus).toBe(110);
  });

  it('sub computes column - literal', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('viewsMinus', (f, fns) => fns.sub(f.views, 10))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.viewsMinus).toBe(90);
  });

  it('mul computes column * literal', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('viewsDouble', (f, fns) => fns.mul(f.views, 2))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.viewsDouble).toBe(200);
  });

  it('div computes column / literal', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('viewsHalf', (f, fns) => fns.div(f.views, 2))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.viewsHalf).toBe(50);
  });

  it('mod computes column % literal', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('viewsMod', (f, fns) => fns.mod(f.views, 3))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.viewsMod).toBe(1);
  });

  it('arithmetic in WHERE clause filters correctly', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id', 'views')
        .where((f, fns) => fns.gt(fns.add(f.views, 50), 150))
        .build(),
    );
    expect(rows.every((r) => r.views + 50 > 150)).toBe(true);
  });

  it('nested arithmetic works', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('computed', (f, fns) => fns.add(fns.mul(f.views, 2), 1))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.computed).toBe(201);
  });
});
