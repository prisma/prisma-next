import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionPlan } from '@prisma-next/contract/types';
import postgres from '@prisma-next/postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { lints, type Plugin, type Runtime } from '@prisma-next/sql-runtime';
import { teardownTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/contract.js';
import { setupE2EDatabase } from './utils.js';

function createPlanCapturePlugin(captured: ExecutionPlan[]): Plugin {
  return {
    name: 'plan-capture',
    async beforeExecute(plan) {
      captured.push(plan);
    },
  };
}

const fixtureContract = loadContractFixture();

async function createPostgresClient(
  client: Client,
  options?: { readonly plugins?: readonly Plugin[] },
): Promise<{ runtime: Runtime; db: ReturnType<typeof postgres<Contract>> }> {
  const db = postgres<Contract>({
    contract: fixtureContract,
    pg: client,
    verify: { mode: 'onFirstUse', requireMarker: true },
    ...(options?.plugins ? { plugins: options.plugins } : {}),
  });
  const runtime = await db.connect();
  return { runtime, db };
}

describe('Kysely build-only lane', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  let userId: number;
  const testTimeout = timeouts.spinUpPpgDev;

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    userId = Math.floor(Math.random() * 1_000_000);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors.
    }
  });

  beforeEach(async () => {
    await setupE2EDatabase(client, fixtureContract, async (c) => {
      await c.query('drop table if exists "user" cascade');
      await c.query(`
        create table "user" (
          id serial primary key,
          email text not null,
          "createdAt" timestamptz not null
        )
      `);

      await c.query('insert into "user" (email, "createdAt") values ($1, $2), ($3, $4), ($5, $6)', [
        'ada@example.com',
        new Date(),
        'tess@example.com',
        new Date(),
        'mike@example.com',
        new Date(),
      ]);
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  }, timeouts.spinUpPpgDev);

  it(
    'creates reads updates and deletes rows through runtime.execute',
    async () => {
      const { runtime, db } = await createPostgresClient(client);

      const created = await runtime
        .execute(
          db.kysely.build(
            db.kysely
              .insertInto('user')
              .values({
                id: userId,
                email: 'test@example.com',
                createdAt: new Date().toISOString(),
              })
              .returningAll(),
          ),
        )
        .toArray();
      expect(created).toHaveLength(1);
      expect(created[0]?.['id']).toBe(userId);
      expect(created[0]?.['email']).toBe('test@example.com');

      const selectQuery = db.kysely
        .selectFrom('user')
        .selectAll()
        .where('email', 'like', '%@example.com')
        .orderBy('id')
        .limit(10);
      const selected = await runtime.execute(db.kysely.build(selectQuery)).toArray();
      expect(selected.length).toBeGreaterThan(0);

      const updated = await runtime
        .execute(
          db.kysely.build(
            db.kysely
              .updateTable('user')
              .set({ email: 'updated@example.com' })
              .where('id', '=', userId)
              .returningAll(),
          ),
        )
        .toArray();
      expect(updated).toHaveLength(1);
      expect(updated[0]?.['email']).toBe('updated@example.com');

      const deleted = await runtime
        .execute(
          db.kysely.build(db.kysely.deleteFrom('user').where('id', '=', userId).returningAll()),
        )
        .toArray();
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.['id']).toBe(userId);
    },
    testTimeout,
  );

  it(
    'commits transaction via runtime connection',
    async () => {
      const { runtime, db } = await createPostgresClient(client);
      const connection = await runtime.connection();

      try {
        const transaction = await connection.transaction();
        try {
          await transaction
            .execute(
              db.kysely.build(
                db.kysely.insertInto('user').values({
                  id: userId,
                  email: 'transaction@example.com',
                  createdAt: new Date().toISOString(),
                }),
              ),
            )
            .toArray();
          await transaction.commit();
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      } finally {
        await connection.release();
      }

      const users = await runtime
        .execute(db.kysely.build(db.kysely.selectFrom('user').selectAll().where('id', '=', userId)))
        .toArray();
      expect(users).toHaveLength(1);
      expect(users[0]?.['email']).toBe('transaction@example.com');
    },
    testTimeout,
  );

  it(
    'rolls back transaction on error',
    async () => {
      const { runtime, db } = await createPostgresClient(client);
      const connection = await runtime.connection();

      await expect(async () => {
        try {
          const transaction = await connection.transaction();
          try {
            await transaction
              .execute(
                db.kysely.build(
                  db.kysely.insertInto('user').values({
                    id: userId,
                    email: 'rollback@example.com',
                    createdAt: new Date().toISOString(),
                  }),
                ),
              )
              .toArray();
            throw new Error('Simulated transaction error');
          } catch (error) {
            await transaction.rollback();
            throw error;
          }
        } finally {
          await connection.release();
        }
      }).rejects.toThrow('Simulated transaction error');

      const users = await runtime
        .execute(db.kysely.build(db.kysely.selectFrom('user').selectAll().where('id', '=', userId)))
        .toArray();
      expect(users).toHaveLength(0);
    },
    testTimeout,
  );

  it(
    'captures ast and lane metadata for built plans',
    async () => {
      const captured: ExecutionPlan[] = [];
      const { runtime, db } = await createPostgresClient(client, {
        plugins: [createPlanCapturePlugin(captured)],
      });

      await runtime
        .execute(
          db.kysely.build(
            db.kysely
              .selectFrom('user')
              .select(['id', 'email'])
              .where('email', 'like', '%@example.com')
              .limit(5),
          ),
        )
        .toArray();

      expect(captured).toHaveLength(1);
      const plan = captured[0]!;
      expect(plan).toMatchObject({
        ast: { kind: 'select' },
        meta: {
          lane: 'kysely',
          refs: {
            tables: expect.arrayContaining(['user']),
            columns: expect.any(Array),
          },
          paramDescriptors: expect.any(Array),
          projection: expect.any(Object),
          projectionTypes: expect.any(Object),
          annotations: { codecs: expect.any(Object) },
        },
      });
      expect(plan.meta.refs?.columns?.length ?? 0).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'blocks delete without where with lint error',
    async () => {
      const { runtime, db } = await createPostgresClient(client, { plugins: [lints()] });

      await expect(
        runtime.execute(db.kysely.build(db.kysely.deleteFrom('user'))).toArray(),
      ).rejects.toMatchObject({
        code: 'LINT.DELETE_WITHOUT_WHERE',
        category: 'LINT',
      });
    },
    testTimeout,
  );

  it(
    'blocks update without where with lint error',
    async () => {
      const { runtime, db } = await createPostgresClient(client, { plugins: [lints()] });

      await expect(
        runtime
          .execute(
            db.kysely.build(db.kysely.updateTable('user').set({ email: 'unsafe@example.com' })),
          )
          .toArray(),
      ).rejects.toMatchObject({
        code: 'LINT.UPDATE_WITHOUT_WHERE',
        category: 'LINT',
      });
    },
    testTimeout,
  );
});

function loadContractFixture(): Contract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, 'fixtures/contract.json');
  const contractJson = JSON.parse(readFileSync(contractPath, 'utf8'));
  return validateContract<Contract>(contractJson);
}
