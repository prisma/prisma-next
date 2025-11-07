import { param } from '@prisma-next/sql-query/param';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import type { Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createPostgresDriverFromOptions } from '../../driver-postgres/src/postgres-driver';
import {
  createDevDatabase,
  createTestRuntime,
  executePlanAndCollect,
  setupTestDatabase,
  teardownTestDatabase,
} from './utils';

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:codecs-test-core',
  profileHash: 'sha256:codecs-test-profile',
  storage: {
    tables: {
      test_data: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          name: { type: 'pg/text@1', nullable: false },
          score: { type: 'pg/float8@1', nullable: false },
          created_at: { type: 'pg/timestamptz@1', nullable: false },
        },
        primaryKey: {
          columns: ['id'],
          name: 'test_data_pkey',
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('Codecs Integration Tests', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: ReturnType<typeof createPostgresDriverFromOptions>;
  let client: Client;
  const adapter = createPostgresAdapter();
  const tables = schema(fixtureContract).tables;
  const builder = sql({ contract: fixtureContract, adapter });

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54003,
      databasePort: 54004,
      shadowDatabasePort: 54005,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    sharedDriver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { disabled: true },
    });
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
    await setupTestDatabase(client, fixtureContract, async (c: typeof client) => {
      await c.query('DROP TABLE IF EXISTS test_data');
      await c.query(`
        CREATE TABLE test_data (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          score FLOAT8 NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
    });
  });

  afterEach(async () => {
    await teardownTestDatabase(client, ['test_data']);
  });

  it('encodes JS Date parameter to ISO string', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const createDate = new Date('2024-01-15T10:30:00Z');

    // Note: We'll test encoding via the INSERT directly since DSL doesn't support INSERT yet

    // Use raw SQL for INSERT since we don't have INSERT support in DSL yet
    await client.query(
      'INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3) RETURNING id',
      ['Test User', 95.5, createDate.toISOString()],
    );

    // Query to verify the date was stored correctly
    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        id: testDataColumns['id']!,
        name: testDataColumns['name']!,
        score: testDataColumns['score']!,
        created_at: testDataColumns['created_at']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0]!;
    expect(row['created_at']).toBeDefined();
    expect(typeof row['created_at']).toBe('string');
    expect(row['created_at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('decodes timestamptz to ISO string', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    // Insert test data with ISO string timestamp
    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        name: testDataColumns['name']!,
        score: testDataColumns['score']!,
        created_at: testDataColumns['created_at']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row['created_at']).toBe('2024-01-15T10:30:00.000Z');
    expect(typeof row['created_at']).toBe('string');
  });

  it('round-trips numbers correctly', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        score: testDataColumns['score']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row['score']).toBe('number');
    expect(row['score']).toBe(95.5);
  });

  it('round-trips strings correctly', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        name: testDataColumns['name']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row['name']).toBe('string');
    expect(row['name']).toBe('Test User');
  });

  it('uses codec override via annotations.codecs', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const basePlan = builder
      .from(testDataTable)
      .select({
        created_at: testDataColumns['created_at']!,
      })
      .build();

    // Create plan with codec override annotation
    const planWithOverride = {
      ...basePlan,
      meta: {
        ...basePlan.meta,
        annotations: {
          ...basePlan.meta.annotations,
          codecs: {
            created_at: 'pg/timestamptz@1',
          },
        },
      },
    } as Plan<unknown>;

    const rows = await executePlanAndCollect(runtime, planWithOverride);
    expect(rows.length).toBe(1);

    const row = rows[0]! as Record<string, unknown>;
    expect(row['created_at']).toBeDefined();
    expect(typeof row['created_at']).toBe('string');
  });

  it('handles null values correctly', async () => {
    // First, alter table to allow nullable created_at for this test
    await client.query('ALTER TABLE test_data ALTER COLUMN created_at DROP NOT NULL');

    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      null,
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        created_at: testDataColumns['created_at']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row['created_at']).toBeNull();
  });

  it('decodes multiple columns with different types', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const selectPlan = builder
      .from(testDataTable)
      .select({
        name: testDataColumns['name']!,
        score: testDataColumns['score']!,
        created_at: testDataColumns['created_at']!,
      })
      .build();

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row['name']).toBe('string');
    expect(typeof row['score']).toBe('number');
    expect(typeof row['created_at']).toBe('string');
    expect(row['name']).toBe('Test User');
    expect(row['score']).toBe(95.5);
    expect(row['created_at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('uses codec assignments from contract column types', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = schema(fixtureContract).tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const testBuilder = sql({ contract: fixtureContract, adapter });
    const selectPlan = testBuilder
      .from(testDataTable)
      .select({
        name: testDataColumns['name']!,
        created_at: testDataColumns['created_at']!,
      })
      .build();

    expect(selectPlan.meta.annotations).toBeDefined();
    expect(selectPlan.meta.annotations?.codecs).toEqual({
      name: 'pg/text@1',
      created_at: 'pg/timestamptz@1',
    });

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row['name']).toBe('string');
    expect(typeof row['created_at']).toBe('string');
    expect(row['name']).toBe('Test User');
    expect(row['created_at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('uses codec assignments from contract column types for WHERE clause parameters', async () => {
    const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = schema(fixtureContract).tables['test_data']!;
    const testDataColumns = testDataTable.columns;
    const testBuilder = sql({ contract: fixtureContract, adapter });
    const selectPlan = testBuilder
      .from(testDataTable)
      .select({
        name: testDataColumns['name']!,
      })
      .where(testDataColumns['id']!.eq(param('id')))
      .build({ params: { id: 1 } });

    expect(selectPlan.meta.annotations).toBeDefined();
    expect(selectPlan.meta.annotations?.codecs).toEqual({
      name: 'pg/text@1',
      id: 'pg/int4@1',
    });

    const rows = await executePlanAndCollect(runtime, selectPlan);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ name: 'Test User' });
  });
});
