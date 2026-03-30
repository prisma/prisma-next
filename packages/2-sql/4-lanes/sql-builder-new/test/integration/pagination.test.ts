import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: LIMIT / OFFSET', () => {
  const { db } = setupIntegrationTest();

  it('LIMIT restricts row count', async () => {
    const rows = await collect(db().users.select('id').orderBy('id').limit(2).all());
    expect(rows).toHaveLength(2);
  });

  it('OFFSET skips rows', async () => {
    const rows = await collect(db().users.select('id').orderBy('id').offset(2).all());
    expect(rows[0]!.id).toBe(3);
  });

  it('LIMIT + OFFSET paginates correctly', async () => {
    const rows = await collect(db().users.select('id').orderBy('id').limit(2).offset(1).all());
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(2);
    expect(rows[1]!.id).toBe(3);
  });
});
