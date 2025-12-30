import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import {
  createTestContext,
  executePlanAndCollect,
  teardownTestDatabase,
} from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import { createTestRuntime, setupTestDatabase } from './utils';

const fixtureContract = loadContractFixture();
const adapter = createPostgresAdapter();

describe('comparison operators integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
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
    await setupTestDatabase(client, fixtureContract, async (c) => {
      await c.query('drop table if exists "user"');
      await c.query(
        `create table "user" (
          id integer primary key generated always as identity,
          email text not null,
          "createdAt" timestamptz not null default now()
        )`,
      );
      // Insert 10 users with sequential IDs (1-10)
      for (let i = 1; i <= 10; i++) {
        await c.query('insert into "user" (email) values ($1)', [`user${i}@example.com`]);
      }
    });
  }, timeouts.databaseOperation);

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  }, timeouts.databaseOperation);

  it('gt operator returns rows where id > cursor', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.gt(param('cursor')))
      .orderBy(user.columns.id.asc())
      .build({ params: { cursor: 5 } });

    const rows = await executePlanAndCollect(runtime, plan);
    expect(rows.map((r) => r.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('lt operator returns rows where id < cursor', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.lt(param('cursor')))
      .orderBy(user.columns.id.asc())
      .build({ params: { cursor: 6 } });

    const rows = await executePlanAndCollect(runtime, plan);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gte operator returns rows where id >= cursor', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.gte(param('cursor')))
      .orderBy(user.columns.id.asc())
      .build({ params: { cursor: 6 } });

    const rows = await executePlanAndCollect(runtime, plan);
    expect(rows.map((r) => r.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('lte operator returns rows where id <= cursor', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.lte(param('cursor')))
      .orderBy(user.columns.id.asc())
      .build({ params: { cursor: 5 } });

    const rows = await executePlanAndCollect(runtime, plan);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('cursor pagination returns correct pages (forward)', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    // First page: no cursor, limit 3
    const firstPagePlan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .orderBy(user.columns.id.asc())
      .limit(3)
      .build();

    const firstPage = await executePlanAndCollect(runtime, firstPagePlan);
    expect(firstPage.map((r) => r.id)).toEqual([1, 2, 3]);

    // Second page: cursor = 3, limit 3
    const lastIdFromFirstPage = firstPage[firstPage.length - 1]!.id;
    const secondPagePlan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.gt(param('cursor')))
      .orderBy(user.columns.id.asc())
      .limit(3)
      .build({ params: { cursor: lastIdFromFirstPage } });

    const secondPage = await executePlanAndCollect(runtime, secondPagePlan);
    expect(secondPage.map((r) => r.id)).toEqual([4, 5, 6]);

    // Third page: cursor = 6, limit 3
    const lastIdFromSecondPage = secondPage[secondPage.length - 1]!.id;
    const thirdPagePlan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.gt(param('cursor')))
      .orderBy(user.columns.id.asc())
      .limit(3)
      .build({ params: { cursor: lastIdFromSecondPage } });

    const thirdPage = await executePlanAndCollect(runtime, thirdPagePlan);
    expect(thirdPage.map((r) => r.id)).toEqual([7, 8, 9]);
  });

  it('cursor pagination returns correct pages (backward)', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    // Backward pagination: get 3 records before id=8
    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.lt(param('cursor')))
      .orderBy(user.columns.id.desc())
      .limit(3)
      .build({ params: { cursor: 8 } });

    const rows = await executePlanAndCollect(runtime, plan);

    // Ordered descending, so 7, 6, 5
    expect(rows.map((r) => r.id)).toEqual([7, 6, 5]);
  });

  it('gt returns empty result when cursor exceeds all values', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.gt(param('cursor')))
      .build({ params: { cursor: 100 } });

    const rows = await executePlanAndCollect(runtime, plan);

    expect(rows.length).toBe(0);
  });

  it('lt returns empty result when cursor is below all values', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { user } = schema(context).tables;

    const plan = sql({ context })
      .from(user)
      .select({ id: user.columns.id, email: user.columns.email })
      .where(user.columns.id.lt(param('cursor')))
      .build({ params: { cursor: 1 } });

    const rows = await executePlanAndCollect(runtime, plan);

    expect(rows.length).toBe(0);
  });
});

function loadContractFixture(): Contract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, 'fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  const contractJson = JSON.parse(json) as unknown;
  return validateContract<Contract>(contractJson);
}
