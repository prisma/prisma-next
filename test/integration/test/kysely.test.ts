import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { teardownTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/contract.js';
import { createTestRuntimeFromClient, setupE2EDatabase } from './utils.js';

// Load contract fixture from the integration test fixtures
const fixtureContract = loadContractFixture();

describe('Kysely integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  /** Raw Postgres client for direct interaction with the database */
  let client: Client;
  /** Test data IDs for cleanup */
  let userId: number;
  const testTimeout = timeouts.spinUpPpgDev;

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();

    // Generate unique IDs for test data
    userId = Math.floor(Math.random() * 1000000);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await setupE2EDatabase(client, fixtureContract, async (c) => {
      // Drop tables if they exist
      await c.query('drop table if exists "user" cascade');

      // Create user table (matches the fixture contract)
      await c.query(`
        create table "user" (
          id serial primary key,
          email text not null,
          "createdAt" timestamptz not null
        )
      `);

      // Insert some seed data
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

  describe('CRUD operations', () => {
    it(
      'creates a user successfully',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        const newUser = {
          id: userId,
          email: 'test@example.com',
          createdAt: new Date(),
        };

        const result = await kysely.insertInto('user').values(newUser).returningAll().execute();

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe(userId);
        expect(result[0]?.email).toBe('test@example.com');
        expect(result[0]?.createdAt).toBeDefined();
      },
      testTimeout,
    );

    it(
      'reads users with select queries',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        // Read existing seed data
        const users = await kysely
          .selectFrom('user')
          .selectAll()
          .where('email', 'like', '%@example.com')
          .orderBy('id')
          .execute();

        expect(users.length).toBeGreaterThan(0);
        expect(users.map((u) => u.email)).toContain('ada@example.com');
      },
      testTimeout,
    );

    it(
      'updates a user email',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        // First create a user
        const createResult = await kysely
          .insertInto('user')
          .values({
            id: userId,
            email: 'old@example.com',
            createdAt: new Date(),
          })
          .returningAll()
          .execute();

        expect(createResult).toHaveLength(1);

        // Update email
        const updateResult = await kysely
          .updateTable('user')
          .set({ email: 'new@example.com' })
          .where('id', '=', userId)
          .returningAll()
          .execute();

        expect(updateResult).toHaveLength(1);
        expect(updateResult[0]?.email).toBe('new@example.com');
      },
      testTimeout,
    );

    it(
      'deletes a user',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        // Create user first
        await kysely
          .insertInto('user')
          .values({
            id: userId,
            email: 'delete@example.com',
            createdAt: new Date(),
          })
          .execute();

        // Delete user
        const deleteResult = await kysely
          .deleteFrom('user')
          .where('id', '=', userId)
          .returningAll()
          .execute();

        expect(deleteResult).toHaveLength(1);
        expect(deleteResult[0]?.id).toBe(userId);

        // Verify deletion
        const user = await kysely
          .selectFrom('user')
          .selectAll()
          .where('id', '=', userId)
          .executeTakeFirst();

        expect(user).toBeUndefined();
      },
      testTimeout,
    );
  });

  describe('transaction functionality', () => {
    it(
      'commits transaction successfully',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        await kysely.transaction().execute(async (trx) => {
          await trx
            .insertInto('user')
            .values({
              id: userId,
              email: 'transaction@example.com',
              createdAt: new Date(),
            })
            .execute();

          await trx
            .insertInto('user')
            .values({
              id: userId + 1,
              email: 'transaction2@example.com',
              createdAt: new Date(),
            })
            .execute();
        });

        // Verify both records were committed
        const users = await kysely
          .selectFrom('user')
          .selectAll()
          .where('id', 'in', [userId, userId + 1])
          .execute();

        expect(users).toHaveLength(2);
        expect(users.some((u) => u.email === 'transaction@example.com')).toBe(true);
        expect(users.some((u) => u.email === 'transaction2@example.com')).toBe(true);
      },
      testTimeout,
    );

    it(
      'rolls back transaction on error',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        await expect(
          kysely.transaction().execute(async (trx) => {
            await trx
              .insertInto('user')
              .values({
                id: userId,
                email: 'rollback@example.com',
                createdAt: new Date(),
              })
              .execute();

            await trx
              .insertInto('user')
              .values({
                id: userId + 1,
                email: 'rollback2@example.com',
                createdAt: new Date(),
              })
              .execute();

            // Simulate error
            throw new Error('Simulated transaction error');
          }),
        ).rejects.toThrow('Simulated transaction error');

        // Verify rollback - no records should exist
        const users = await kysely
          .selectFrom('user')
          .selectAll()
          .where('id', 'in', [userId, userId + 1])
          .execute();

        expect(users).toHaveLength(0);
      },
      testTimeout,
    );
  });

  describe('dialect functionality', () => {
    it(
      'creates dialect instance successfully',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        expect(kysely).toBeDefined();
        expect(kysely.isTransaction).toBe(false);
      },
      testTimeout,
    );

    it(
      'executes raw SQL queries',
      async () => {
        const runtime = createTestRuntimeFromClient(fixtureContract, client, {
          verify: { mode: 'onFirstUse', requireMarker: true },
        });

        const kysely = new Kysely<KyselifyContract<Contract>>({
          dialect: new KyselyPrismaDialect({ runtime, contract: fixtureContract }),
        });

        // Use existing seed data
        const result = await sql<{ id: number; email: string; createdAt: string }>`
        SELECT * FROM "user" WHERE email = ${'ada@example.com'}
      `.execute(kysely);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.email).toBe('ada@example.com');
      },
      testTimeout,
    );
  });
});

function loadContractFixture(): Contract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, 'fixtures/contract.json');
  const contractJson = JSON.parse(readFileSync(contractPath, 'utf8'));
  return validateContract<Contract>(contractJson);
}
