import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { PostgresDriver } from '@prisma-next/driver-postgres';
import { createRuntime, ensureSchemaStatement, ensureTableStatement, writeContractMarker, budgets } from '../src/runtime';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createDevDatabase } from './utils';
import type { DataContract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';

const fixtureContract: DataContract = {
  target: 'postgres',
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },
          email: { type: 'text', nullable: false },
        },
      },
    },
  },
};

describe('budgets plugin integration', { timeout: 100 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: PostgresDriver;
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54010,
      databasePort: 54011,
      shadowDatabasePort: 54012,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    sharedDriver = new PostgresDriver({
      connect: { client },
      cursor: { disabled: true },
    });
  }, 3000);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch (error) {}
  });

  beforeEach(async () => {
    await client.query('drop schema if exists prisma_contract cascade');
    await client.query('create schema if not exists public');
    await client.query('drop table if exists "user"');
    await client.query('create table "user" (id text primary key, email text not null)');

    // Insert rows for budget testing (enough to test streaming but not overwhelm DB)
    const values: string[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(`('id-${i}', 'user${i}@example.com')`);
    }
    await client.query(`insert into "user" (id, email) values ${values.join(', ')}`);

    await client.query(ensureSchemaStatement.sql);
    await client.query(ensureTableStatement.sql);

    const write = writeContractMarker({
      coreHash: fixtureContract.coreHash,
      profileHash: fixtureContract.profileHash ?? 'sha256:test-profile',
      contractJson: fixtureContract,
      canonicalVersion: 1,
    });
    await client.query(write.insert.sql, [...write.insert.params]);
  });

  afterEach(async () => {
    await client.query('drop schema if exists prisma_contract cascade');
    await client.query('drop table if exists "user"');
  });

  it('blocks unbounded DSL SELECT exceeding budget', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter: createPostgresAdapter(),
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      plugins: [
        budgets({
          maxRows: 50, // Lower budget to ensure unbounded query exceeds it
          defaultTableRows: 10_000,
          tableRows: { user: 10_000 },
        }),
      ],
    });

    const tables = schema(fixtureContract).tables;
    const builder = sql({ contract: fixtureContract, adapter: createPostgresAdapter() });
    const plan = builder.from(tables.user).select('id', 'email').build();

    // Unbounded SELECT should be blocked pre-exec (estimated 10_000 > maxRows 50)
    await expect(async () => {
      for await (const _row of runtime.execute(plan)) {
        // Should not reach here
      }
    }).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('allows bounded DSL SELECT within budget', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter: createPostgresAdapter(),
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      plugins: [
        budgets({
          maxRows: 10_000,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000 },
        }),
      ],
    });

    const tables = schema(fixtureContract).tables;
    const builder = sql({ contract: fixtureContract, adapter: createPostgresAdapter() });
    const plan = builder.from(tables.user).select('id', 'email').limit(5).build();

    // Bounded SELECT with LIMIT 5 should pass
    const results: Record<string, unknown>[] = [];
    for await (const row of runtime.execute(plan)) {
      results.push(row);
    }
    expect(results.length).toBe(5);
  });

  it('blocks streaming when observed rows exceed budget', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter: createPostgresAdapter(),
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      plugins: [
        budgets({
          maxRows: 10,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000 },
        }),
      ],
    });

    const tables = schema(fixtureContract).tables;
    const builder = sql({ contract: fixtureContract, adapter: createPostgresAdapter() });
    // Use LIMIT that's within heuristic but exceeds streaming budget
    const plan = builder.from(tables.user).select('id', 'email').limit(100).build();

    // Should throw during streaming when observed rows > maxRows
    await expect(async () => {
      let count = 0;
      for await (const _row of runtime.execute(plan)) {
        count++;
        if (count > 20) {
          // Should have thrown by now
          break;
        }
      }
    }).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('blocks unbounded raw SELECT without detectable LIMIT', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter: createPostgresAdapter(),
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      plugins: [
        budgets({
          maxRows: 10_000,
        }),
      ],
    });

    const { raw } = sql({ contract: fixtureContract, adapter: createPostgresAdapter() });
    const plan = raw`SELECT id, email FROM "user"`;

    // Unbounded raw SELECT should be blocked pre-exec
    await expect(async () => {
      for await (const _row of runtime.execute(plan)) {
        // Should not reach here
      }
    }).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('allows raw SELECT with detectable LIMIT via annotations', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter: createPostgresAdapter(),
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      plugins: [
        budgets({
          maxRows: 10_000,
        }),
      ],
    });

    const { raw } = sql({ contract: fixtureContract, adapter: createPostgresAdapter() });
    const plan = raw.with({ annotations: { limit: 5 } })`SELECT id, email FROM "user" LIMIT 5`;

    // Raw SELECT with limit annotation should pass
    const results: Record<string, unknown>[] = [];
    for await (const row of runtime.execute(plan)) {
      results.push(row);
    }
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

