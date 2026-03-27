import { describe, expect, it } from 'vitest';
import { setupIntegrationTest } from './setup';

describe('integration: execution methods', () => {
  const { db } = setupIntegrationTest();

  it('.first() returns first row', async () => {
    const row = await db()
      .users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 1))
      .first();
    expect(row).not.toBeNull();
    expect(row!.id).toBe(1);
    expect(row!.name).toBe('Alice');
  });

  it('.first() returns null on empty result', async () => {
    const row = await db()
      .users.select('id')
      .where((f, fns) => fns.eq(f.id, 9999))
      .first();
    expect(row).toBeNull();
  });

  it('.firstOrThrow() returns row when found', async () => {
    const row = await db()
      .users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 2))
      .firstOrThrow();
    expect(row.id).toBe(2);
    expect(row.name).toBe('Bob');
  });

  it('.firstOrThrow() throws on empty result', async () => {
    await expect(
      db()
        .users.select('id')
        .where((f, fns) => fns.eq(f.id, 9999))
        .firstOrThrow(),
    ).rejects.toThrow('Expected at least one row');
  });
});
