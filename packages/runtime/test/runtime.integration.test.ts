import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { validateContract } from '@prisma-next/sql-query/schema';

import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

import { budgets } from '../src/plugins/budgets';
import { lints } from '../src/plugins/lints';
import { createPostgresDriverFromOptions } from '../../driver-postgres/src/postgres-driver';
import {
  createDevDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  createTestRuntime,
  executePlanAndCollect,
  drainPlanExecution,
} from './utils';

const fixtureContract = loadContractFixture();
const tables = schema(fixtureContract).tables;
const adapter = createPostgresAdapter();
const userTable = tables['user']!;
const userColumns = userTable.columns;
const builder = sql({ contract: fixtureContract, adapter });
const plan = builder
  .from(userTable)
  .select({ id: userColumns['id']!, email: userColumns['email']! })
  .limit(5)
  .build();

describe('runtime execute integration', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: ReturnType<typeof createPostgresDriverFromOptions>;
  /** Raw Postgres client for direct interaction with the database */
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 53213,
      databasePort: 53214,
      shadowDatabasePort: 53215,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    sharedDriver = createPostgresDriverFromOptions({
      connect: { client: client },
      cursor: { disabled: true },
    });
  }, 30000);

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
  });

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  });

  it('executes a plan after onFirstUse verification', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const rows = await executePlanAndCollect<Record<string, unknown>>(runtime, plan);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r['email'])).toContain('ada@example.com');
  });

  it('throws when marker hash mismatches contract', async () => {
    const mismatchedContract: SqlContract<SqlStorage> = {
      ...fixtureContract,
      coreHash: 'sha256:mismatch',
    };

    const runtime = createTestRuntime(mismatchedContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    await expect(async () => {
      await drainPlanExecution(runtime, plan);
    }).rejects.toMatchObject({ code: 'PLAN.HASH_MISMATCH' });
  });

  it('blocks raw select star with lint error', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [lints()],
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
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
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [lints(), budgets()],
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await expect(async () => {
      await drainPlanExecution(runtime, rawPlan);
    }).rejects.toMatchObject({ code: 'BUDGET.ROWS_EXCEEDED' });

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'runtime-error', lane: 'raw' });
  });

  it('records unindexed predicate warning when refs lack indexes', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [lints()],
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw(
      'select id from "user" where email = $1 limit $2',
      {
        params: ['ada@example.com', 1],
        refs: {
          tables: ['user'],
          columns: [{ table: 'user', column: 'email' }],
          indexes: [],
        },
      },
    );

    const rows = await executePlanAndCollect<{ id: number }>(runtime, rawPlan);

    expect(rows.length).toBeGreaterThan(0);

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
  });

  it('prevents read-only mutation when annotations intent is report', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [lints()],
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw(
      'insert into "user" (email) values ($1)',
      {
        params: ['read-only@example.com'],
        annotations: { intent: 'report' },
      },
    );

    await expect(async () => {
      await drainPlanExecution(runtime, rawPlan);
    }).rejects.toMatchObject({ code: 'LINT.READ_ONLY_MUTATION' });

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'runtime-error', lane: 'raw' });
  });

  it('respects unbounded select severity override', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [
        budgets({
          severities: { rowCount: 'warn' },
        }),
      ],
      mode: 'permissive',
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await drainPlanExecution(runtime, rawPlan);

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
  });

  it('attaches explain estimates when enabled', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [
        budgets({
          explain: { enabled: true },
          severities: { rowCount: 'warn' },
        }),
      ],
      mode: 'permissive',
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await drainPlanExecution(runtime, rawPlan);

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
    expect(telemetry?.fingerprint).toBeTypeOf('string');
  });

  it('emits stable fingerprint for literal-only differences', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const planOne = sql({ contract: fixtureContract, adapter }).raw(
      'select id from "user" where email = \'ada@example.com\' limit 1',
      { params: [] },
    );

    await drainPlanExecution(runtime, planOne);
    const fingerprintOne = runtime.telemetry()?.fingerprint;

    const planTwo = sql({ contract: fixtureContract, adapter }).raw(
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
  const contractPath = join(fixtureDir, '../../sql-query/test/fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  const contractJson = JSON.parse(json) as unknown;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}
