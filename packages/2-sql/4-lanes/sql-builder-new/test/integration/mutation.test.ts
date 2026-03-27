import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: mutations', () => {
  const { db } = setupIntegrationTest();

  it('INSERT returns inserted row via returning', async () => {
    const row = await db()
      .users.insert({ id: 100, name: 'NewUser', email: 'new@test.com' })
      .returning('id', 'name')
      .first();
    expect(row).not.toBeNull();
    expect(row!.id).toBe(100);
    expect(row!.name).toBe('NewUser');

    const rows = await collect(db().users.select('id', 'name').all());
    expect(rows.find((r) => r.id === 100)).toEqual({ id: 100, name: 'NewUser' });
  });

  it('UPDATE with WHERE returns updated row', async () => {
    const row = await db()
      .users.update({ name: 'UpdatedAlice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .returning('id', 'name')
      .first();
    expect(row).not.toBeNull();
    expect(row!.name).toBe('UpdatedAlice');

    const verified = await db()
      .users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 1))
      .first();
    expect(verified!.name).toBe('UpdatedAlice');
  });

  it('DELETE with WHERE returns deleted row', async () => {
    const row = await db()
      .users.delete()
      .where((f, fns) => fns.eq(f.id, 4))
      .returning('id', 'name')
      .first();
    expect(row).not.toBeNull();
    expect(row!.id).toBe(4);

    const deleted = await db()
      .users.select('id')
      .where((f, fns) => fns.eq(f.id, 4))
      .first();
    expect(deleted).toBeNull();
  });

  it('UPDATE accumulates multiple where() clauses with AND', async () => {
    await db().users.insert({ id: 300, name: 'Multi', email: 'multi@test.com' }).first();

    const row = await db()
      .users.update({ name: 'MultiUpdated' })
      .where((f, fns) => fns.eq(f.name, 'Multi'))
      .where((f, fns) => fns.eq(f.email, 'multi@test.com'))
      .returning('id', 'name')
      .first();
    expect(row).not.toBeNull();
    expect(row!.name).toBe('MultiUpdated');
  });

  it('INSERT without returning executes silently', async () => {
    const row = await db()
      .users.insert({ id: 200, name: 'Silent', email: 'silent@test.com' })
      .first();
    expect(row).toBeNull();

    const inserted = await db()
      .users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 200))
      .first();
    expect(inserted).toEqual({ id: 200, name: 'Silent' });
  });
});
