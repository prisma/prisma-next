import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { schema } from '@prisma-next/sql/schema';
import { sql } from '@prisma-next/sql/sql';

import type { SqlContract } from '@prisma-next/contract/types';

import { createRuntime } from '../src/runtime';
import { ensureSchemaStatement, ensureTableStatement, writeContractMarker } from '../src/marker';
import { PostgresDriver } from '../../driver-postgres/src/postgres-driver';
import { createDevDatabase, drainAsyncIterable, executeStatement, collectAsync } from './utils';

const fixtureContract = loadContractFixture();
const tables = schema(fixtureContract).tables;
const adapter = createPostgresAdapter();
const builder = sql({ contract: fixtureContract, adapter });
const plan = builder.from(tables.user).select('id', 'email').limit(5).build();

describe('runtime execute integration', { timeout: 100 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: PostgresDriver;
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
    sharedDriver = new PostgresDriver({
      connect: { client: client },
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
    await client.query('create table "user" (id serial primary key, email text not null)');
    await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
      'ada@example.com',
      'tess@example.com',
      'mike@example.com',
    ]);

    await executeStatement(client, ensureSchemaStatement);
    await executeStatement(client, ensureTableStatement);

    const write = writeContractMarker({
      coreHash: fixtureContract.coreHash,
      profileHash: fixtureContract.profileHash ?? 'sha256:test-profile',
      contractJson: fixtureContract,
      canonicalVersion: 1,
    });
    await executeStatement(client, write.insert);
  });

  afterEach(async () => {
    await client.query('drop schema if exists prisma_contract cascade');
    await client.query('drop table if exists "user"');
  });

  it('executes a plan after onFirstUse verification', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const rows = await collectAsync(runtime.execute(plan));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.email)).toContain('ada@example.com');
  });

  it('throws when marker hash mismatches contract', async () => {
    const mismatchedContract: SqlContract = {
      ...fixtureContract,
      coreHash: 'sha256:mismatch',
    };

    const runtime = createRuntime({
      contract: mismatchedContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    await expect(async () => {
      await drainAsyncIterable(runtime.execute(plan));
    }).rejects.toMatchObject({ code: 'PLAN.HASH_MISMATCH' });
  });

  it('blocks raw select star with lint error', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select * from "user"
    `;

    await expect(async () => {
      await drainAsyncIterable(runtime.execute(rawPlan));
    }).rejects.toMatchObject({ code: 'LINT.SELECT_STAR' });

    const diagnostics = runtime.diagnostics();
    expect(diagnostics.lints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LINT.SELECT_STAR', severity: 'error' }),
      ]),
    );

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({
      outcome: 'lint-error',
      lane: 'raw',
      target: 'postgres',
    });
    expect(telemetry?.fingerprint).toBeTypeOf('string');
  });

  it('warns on missing limit and blocks via budget heuristic', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await expect(async () => {
      await drainAsyncIterable(runtime.execute(rawPlan));
    }).rejects.toMatchObject({ code: 'BUDGET.ROWS_EXCEEDED' });

    const diagnostics = runtime.diagnostics();
    expect(diagnostics.lints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LINT.NO_LIMIT', severity: 'warn' }),
      ]),
    );
    expect(diagnostics.budgets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BUDGET.ROWS_EXCEEDED', severity: 'error' }),
      ]),
    );

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'budget-error', lane: 'raw' });
  });

  it('records unindexed predicate warning when refs lack indexes', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
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

    const rows = await collectAsync<{ id: number }>(
      runtime.execute(rawPlan) as AsyncIterable<{ id: number }>,
    );

    expect(rows.length).toBeGreaterThan(0);

    const diagnostics = runtime.diagnostics();
    expect(diagnostics.lints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LINT.UNINDEXED_PREDICATE', severity: 'warn' }),
      ]),
    );

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
  });

  it('prevents read-only mutation when annotations intent is report', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw(
      'insert into "user" (email) values ($1)',
      {
        params: ['read-only@example.com'],
        annotations: { intent: 'report' },
      },
    );

    await expect(async () => {
      await drainAsyncIterable(runtime.execute(rawPlan));
    }).rejects.toMatchObject({ code: 'LINT.READ_ONLY_MUTATION' });

    const diagnostics = runtime.diagnostics();
    expect(diagnostics.lints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LINT.READ_ONLY_MUTATION', severity: 'error' }),
      ]),
    );

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'lint-error', lane: 'raw' });
  });

  it('respects unbounded select severity override', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
      guardrails: { budgets: { unboundedSelectSeverity: 'warn' } },
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await drainAsyncIterable(runtime.execute(rawPlan));

    const diagnostics = runtime.diagnostics();
    expect(diagnostics.budgets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BUDGET.ROWS_EXCEEDED', severity: 'warn' }),
      ]),
    );

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
  });

  it('attaches explain estimates when enabled', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
      guardrails: { budgets: { unboundedSelectSeverity: 'warn', explain: { enabled: true } } },
    });

    const rawPlan = sql({ contract: fixtureContract, adapter }).raw`
      select id from "user"
    `;

    await drainAsyncIterable(runtime.execute(rawPlan));

    const diagnostics = runtime.diagnostics();
    const budgetFinding = diagnostics.budgets.find(
      (finding) => finding.code === 'BUDGET.ROWS_EXCEEDED',
    );
    expect(budgetFinding).toBeDefined();
    expect(budgetFinding?.details?.estimatedRows).toBeTypeOf('number');

    const telemetry = runtime.telemetry();
    expect(telemetry).toMatchObject({ outcome: 'success', lane: 'raw' });
    expect(telemetry?.fingerprint).toBeTypeOf('string');
  });

  it('emits stable fingerprint for literal-only differences', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: true },
      guardrails: { budgets: { unboundedSelectSeverity: 'warn' } },
    });

    const planOne = sql({ contract: fixtureContract, adapter }).raw(
      'select id from "user" where email = \'ada@example.com\' limit 1',
      { params: [] },
    );

    await drainAsyncIterable(runtime.execute(planOne));
    const fingerprintOne = runtime.telemetry()?.fingerprint;

    const planTwo = sql({ contract: fixtureContract, adapter }).raw(
      'select id from "user" where email = \'tess@example.com\' limit 1',
      { params: [] },
    );

    await drainAsyncIterable(runtime.execute(planTwo));
    const fingerprintTwo = runtime.telemetry()?.fingerprint;

    expect(fingerprintOne).toBeTypeOf('string');
    expect(fingerprintTwo).toBe(fingerprintOne);
  });
});

function loadContractFixture(): SqlContract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, '../../sql/test/fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  return JSON.parse(json) as SqlContract;
}
