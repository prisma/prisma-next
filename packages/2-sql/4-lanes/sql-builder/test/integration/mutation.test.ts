import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: mutations', () => {
  const { db, runtime } = setupIntegrationTest();

  it('INSERT returns inserted row via returning', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.insert({ id: 100, name: 'NewUser', email: 'new@test.com' })
          .returning('id', 'name')
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).not.toBeNull();
    expect(row!.id).toBe(100);
    expect(row!.name).toBe('NewUser');

    const allRows = await collect(runtime().execute(db().users.select('id', 'name').build()));
    expect(allRows.find((r) => r.id === 100)).toEqual({ id: 100, name: 'NewUser' });
  });

  it('UPDATE with WHERE returns updated row', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.update({ name: 'UpdatedAlice' })
          .where((f, fns) => fns.eq(f.id, 1))
          .returning('id', 'name')
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe('UpdatedAlice');

    const verifyRows = await collect(
      runtime().execute(
        db()
          .users.select('id', 'name')
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      ),
    );
    const verified = verifyRows[0] ?? null;
    expect(verified!.name).toBe('UpdatedAlice');
  });

  it('DELETE with WHERE returns deleted row', async () => {
    const rows = await collect(
      runtime().execute(
        db()
          .users.delete()
          .where((f, fns) => fns.eq(f.id, 4))
          .returning('id', 'name')
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).not.toBeNull();
    expect(row!.id).toBe(4);

    const deletedRows = await collect(
      runtime().execute(
        db()
          .users.select('id')
          .where((f, fns) => fns.eq(f.id, 4))
          .build(),
      ),
    );
    const deleted = deletedRows[0] ?? null;
    expect(deleted).toBeNull();
  });

  it('UPDATE accumulates multiple where() clauses with AND', async () => {
    await collect(
      runtime().execute(
        db().users.insert({ id: 300, name: 'Multi', email: 'multi@test.com' }).build(),
      ),
    );

    const rows = await collect(
      runtime().execute(
        db()
          .users.update({ name: 'MultiUpdated' })
          .where((f, fns) => fns.eq(f.name, 'Multi'))
          .where((f, fns) => fns.eq(f.email, 'multi@test.com'))
          .returning('id', 'name')
          .build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe('MultiUpdated');
  });

  it('INSERT without returning executes silently', async () => {
    const rows = await collect(
      runtime().execute(
        db().users.insert({ id: 200, name: 'Silent', email: 'silent@test.com' }).build(),
      ),
    );
    const row = rows[0] ?? null;
    expect(row).toBeNull();

    const insertedRows = await collect(
      runtime().execute(
        db()
          .users.select('id', 'name')
          .where((f, fns) => fns.eq(f.id, 200))
          .build(),
      ),
    );
    const inserted = insertedRows[0] ?? null;
    expect(inserted).toEqual({ id: 200, name: 'Silent' });
  });
});
