import { describe, expect, it } from 'vitest';
import { setupIntegrationTest } from './setup';

describe('integration: type cast', () => {
  const { db, runtime } = setupIntegrationTest();

  it('cast int to text', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .select('idText', (f, fns) => fns.cast(f.id, { codecId: 'pg/text@1', nullable: false }))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows[0]!.idText).toBe('1');
  });

  it('cast in WHERE clause', async () => {
    const rows = await runtime().execute(
      db()
        .posts.select('id')
        .where((f, fns) => fns.eq(fns.cast(f.id, { codecId: 'pg/text@1', nullable: false }), '1'))
        .build(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(1);
  });
});
