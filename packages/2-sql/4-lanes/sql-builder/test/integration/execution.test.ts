import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: execution methods', () => {
  const { db, runtime } = setupIntegrationTest();

  it('returns first row', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.select('id', 'name')
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).not.toBeNull();
    expect(row!.id).toBe(1);
    expect(row!.name).toBe('Alice');
  });

  it('returns null on empty result', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.select('id')
          .where((f, fns) => fns.eq(f.id, 9999))
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).toBeNull();
  });

  it('returns row when found', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.select('id', 'name')
          .where((f, fns) => fns.eq(f.id, 2))
          .build(),
      ),
    );
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.id).toBe(2);
    expect(row!.name).toBe('Bob');
  });
});
