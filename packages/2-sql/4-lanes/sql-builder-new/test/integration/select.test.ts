import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: SELECT', () => {
  const { db } = setupIntegrationTest();

  it('basic column projection returns correct rows', async () => {
    const rows = await collect(db().users.select('id', 'name').all());
    expect(rows).toHaveLength(4);
    expect(typeof rows[0]!.id).toBe('number');
    expect(typeof rows[0]!.name).toBe('string');
  });

  it('aliased expression select', async () => {
    const rows = await collect(
      db()
        .users.select('id')
        .select('userName', (f) => f.name)
        .all(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).toHaveProperty('userName');
  });

  it('callback record select', async () => {
    const rows = await collect(
      db()
        .users.select((f) => ({ myId: f.id, myName: f.name }))
        .all(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('myId');
    expect(rows[0]).toHaveProperty('myName');
  });

  it('chained select accumulates projections', async () => {
    const rows = await collect(db().users.select('id').select('name').all());
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).toHaveProperty('name');
  });
});
