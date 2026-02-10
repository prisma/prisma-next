import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { budgets, lints } from '@prisma-next/sql-runtime';
import {
  createTestContext,
  drainPlanExecution,
  executePlanAndCollect,
  teardownTestDatabase,
} from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestRuntime, setupTestDatabase } from './utils';

const fixtureContract = loadContractFixture();
const adapter = createPostgresAdapter();

describe('runtime execute integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  /** Raw Postgres client for direct interaction with the database */
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
      await c.query('create table "user" (id serial primary key, email text not null)');
      await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
        'ada@example.com',
        'tess@example.com',
        'mike@example.com',
      ]);
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  }, timeouts.spinUpPpgDev);

  it('executes a plan after onFirstUse verification', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const plan = sql({ context })
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(5)
      .build();

    const rows = await executePlanAndCollect(runtime, plan);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r['email'])).toContain('ada@example.com');
  });

  it('throws when marker hash mismatches contract', async () => {
    const mismatchedContract: SqlContract<SqlStorage> = {
      ...fixtureContract,
      storageHash: coreHash('sha256:mismatch'),
    };

    const runtime = createTestRuntime(
      mismatchedContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const plan = sql({ context })
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(5)
      .build();

    await expect(async () => {
      await drainPlanExecution(runtime, plan);
    }).rejects.toMatchObject({ code: 'PLAN.HASH_MISMATCH' });
  });

  it('blocks raw select star with lint error', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
        plugins: [lints()],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const rawPlan = sql({ context }).raw`
      select * from "user"
    `;

    await expect(async () => {
      await drainPlanExecution(runtime, rawPlan);
    }).rejects.toMatchObject({ code: 'LINT.SELECT_STAR' });

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({
      outcome: 'runtime-error',
      lane: 'raw',
      target: 'postgres',
    });
    expect(telemetry?.fingerprint).toBeTypeOf('string');
  });

  it('warns on missing limit and blocks via budget heuristic', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
        plugins: [lints(), budgets()],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const rawPlan = sql({ context }).raw`
      select id from "user"
    `;

    await expect(async () => {
      await drainPlanExecution(runtime, rawPlan);
    }).rejects.toMatchObject({ code: 'BUDGET.ROWS_EXCEEDED' });

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'runtime-error', lane: 'raw' });
  });

  it('records unindexed predicate warning when refs lack indexes', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
        plugins: [lints()],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const rawPlan = sql({ context }).raw('select id from "user" where email = $1 limit $2', {
      params: ['ada@example.com', 1],
      refs: {
        tables: ['user'],
        columns: [{ table: 'user', column: 'email' }],
        indexes: [],
      },
    });

    const rows = await executePlanAndCollect(runtime, rawPlan);

    expect(rows.length).toBeGreaterThan(0);

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
  });

  it('prevents read-only mutation when annotations intent is report', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
        plugins: [lints()],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const rawPlan = sql({ context }).raw('insert into "user" (email) values ($1)', {
      params: ['read-only@example.com'],
      annotations: { intent: 'report' },
    });

    await expect(async () => {
      await drainPlanExecution(runtime, rawPlan);
    }).rejects.toMatchObject({ code: 'LINT.READ_ONLY_MUTATION' });

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'runtime-error', lane: 'raw' });
  });

  it(
    'respects unbounded select severity override',
    async () => {
      const runtime = createTestRuntime(
        fixtureContract,
        {
          connect: { client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              severities: { rowCount: 'warn' },
            }),
          ],
          mode: 'permissive',
        },
      );

      const context = createTestContext(fixtureContract, adapter);
      const rawPlan = sql({ context }).raw`
      select id from "user"
    `;

      await drainPlanExecution(runtime, rawPlan);

      const telemetry = runtime.telemetry();
      expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
    },
    timeouts.databaseOperation,
  );

  it(
    'attaches explain estimates when enabled',
    async () => {
      const runtime = createTestRuntime(
        fixtureContract,
        {
          connect: { client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              explain: { enabled: true },
              severities: { rowCount: 'warn' },
            }),
          ],
          mode: 'permissive',
        },
      );

      const context = createTestContext(fixtureContract, adapter);
      const rawPlan = sql({ context }).raw`
      select id from "user"
    `;

      await drainPlanExecution(runtime, rawPlan);

      const telemetry = runtime.telemetry();
      expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
      expect(telemetry?.fingerprint).toBeTypeOf('string');
    },
    timeouts.databaseOperation,
  );

  it('emits stable fingerprint for literal-only differences', async () => {
    const runtime = createTestRuntime(
      fixtureContract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const planOne = sql({ context }).raw(
      'select id from "user" where email = \'ada@example.com\' limit 1',
      { params: [] },
    );

    await drainPlanExecution(runtime, planOne);
    const fingerprintOne = runtime.telemetry()?.fingerprint;

    const planTwo = sql({ context }).raw(
      'select id from "user" where email = \'tess@example.com\' limit 1',
      { params: [] },
    );

    await drainPlanExecution(runtime, planTwo);
    const fingerprintTwo = runtime.telemetry()?.fingerprint;

    expect(fingerprintOne).toBeTypeOf('string');
    expect(fingerprintTwo).toBe(fingerprintOne);
  });
});

function loadContractFixture(): SqlContract<SqlStorage> {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, 'fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  const contractJson = JSON.parse(json) as unknown;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}
