import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: WHERE', () => {
  const { db } = setupIntegrationTest();

  it('eq filters to matching row', async () => {
    const row = await db()
      .users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 1))
      .first();
    expect(row).not.toBeNull();
    expect(row!.id).toBe(1);
    expect(row!.name).toBe('Alice');
  });

  it('gt filters rows', async () => {
    const rows = await collect(
      db()
        .users.select('id')
        .where((f, fns) => fns.gt(f.id, 2))
        .all(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.id > 2)).toBe(true);
  });

  it('lt filters rows', async () => {
    const rows = await collect(
      db()
        .users.select('id')
        .where((f, fns) => fns.lt(f.id, 3))
        .all(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.id < 3)).toBe(true);
  });

  it('multiple where calls AND together', async () => {
    const rows = await collect(
      db()
        .users.select('id')
        .where((f, fns) => fns.gt(f.id, 1))
        .where((f, fns) => fns.lt(f.id, 4))
        .all(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([2, 3]);
  });

  it('or within a single where', async () => {
    const rows = await collect(
      db()
        .users.select('id')
        .where((f, fns) => fns.or(fns.eq(f.id, 1), fns.eq(f.id, 4)))
        .orderBy('id')
        .all(),
    );
    expect(rows.map((r) => r.id)).toEqual([1, 4]);
  });
});
