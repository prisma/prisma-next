import { describe, expect, it } from 'vitest';

describe('createDb', () => {
  it('builds a client from explicit databaseUrl', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/prisma_next_demo';
    const { createDb } = await import('./db');
    const db = createDb('postgresql://example:5432/db');

    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();
  });
});
