/**
 * `prismaNextAdapter({ pg })` — the app hands over its shared connection
 * pool and the adapter constructs its space-scoped client view internally.
 * No user-visible second client, no space-contract ceremony: the pool
 * owner keeps lifecycle, the adapter keeps the view.
 */
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import baselineOps from '../migrations/20260713T0717_create_auth_tables/ops.json' with {
  type: 'json',
};
import { prismaNextAdapter } from '../src/exports/adapter';

type DbAdapter = ReturnType<ReturnType<typeof prismaNextAdapter>>;

let database: Awaited<ReturnType<typeof createDevDatabase>>;
let pool: Pool;
let adapter: DbAdapter;

beforeAll(async () => {
  database = await createDevDatabase();
  await withClient(database.connectionString, async (pg) => {
    for (const op of baselineOps) {
      for (const step of op.execute) {
        await pg.query(step.sql, 'params' in step ? [...step.params] : []);
      }
    }
  });
  pool = new Pool({ connectionString: database.connectionString });
  adapter = prismaNextAdapter({ pg: pool })({});
}, timeouts.spinUpPpgDev);

afterAll(async () => {
  await pool?.end();
  await database?.close();
}, timeouts.spinUpPpgDev);

beforeEach(async () => {
  await withClient(database.connectionString, async (pg) => {
    await pg.query('DELETE FROM "public"."session"');
    await pg.query('DELETE FROM "public"."user"');
  });
});

describe('prismaNextAdapter({ pg }) over a shared pool', () => {
  it('serves CRUD through the internally-built space view', async () => {
    const created = await adapter.create<Record<string, unknown>>({
      model: 'user',
      data: {
        name: 'Pool User',
        email: 'pool@example.com',
        emailVerified: false,
        image: null,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
        updatedAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    });
    expect(created['id']).toBeTypeOf('string');
    expect(created['createdAt']).toBeInstanceOf(Date);

    const found = await adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: 'pool@example.com' }],
    });
    expect(found?.['name']).toBe('Pool User');
  });

  it('transaction rolls back through the shared pool', async () => {
    await expect(
      adapter.transaction(async (tx) => {
        await tx.create({
          model: 'user',
          data: {
            name: 'Doomed',
            email: 'doomed@example.com',
            emailVerified: false,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    expect(await adapter.count({ model: 'user' })).toBe(0);
  });

  it('shares the pool with the caller (no second connection universe)', async () => {
    await adapter.create({
      model: 'user',
      data: {
        name: 'Shared',
        email: 'shared@example.com',
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // The caller's own pool sees the row committed by the adapter.
    const viaPool = await pool.query('SELECT name FROM "public"."user"');
    expect(viaPool.rows).toEqual([{ name: 'Shared' }]);
  });
});
