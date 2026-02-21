import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { ExecutionPlan } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
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
import { createTestRuntime, setupTestDatabase } from './utils';

const makeColumn = (nativeType: string, codecId: string, nullable: boolean): StorageColumn => ({
  nativeType,
  codecId,
  nullable,
});

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:codecs-test-core'),
  profileHash: profileHash('sha256:codecs-test-profile'),
  storage: {
    tables: {
      test_data: {
        columns: {
          id: makeColumn('int4', 'pg/int4@1', false),
          name: makeColumn('text', 'pg/text@1', false),
          score: makeColumn('float8', 'pg/float8@1', false),
          created_at: makeColumn('timestamptz', 'pg/timestamptz@1', false),
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
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
  capabilities: {},
  extensionPacks: {},
  meta: {},
  sources: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('Codecs Integration Tests', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  const adapter = createPostgresAdapter();

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
  }, timeouts.databaseOperation);

  afterEach(async () => {
    await teardownTestDatabase(client, ['test_data']);
  }, timeouts.databaseOperation);

  it(
    'encodes JS Date parameter to ISO string',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      const createDate = new Date('2024-01-15T10:30:00Z');

      // Note: We'll test encoding via the INSERT directly since DSL doesn't support INSERT yet

      // Use raw SQL for INSERT since we don't have INSERT support in DSL yet
      await client.query(
        'INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3) RETURNING id',
        ['Test User', 95.5, createDate.toISOString()],
      );

      // Query to verify the date was stored correctly
      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
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
      expect(row).toMatchObject({
        created_at: expect.any(Date),
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'decodes timestamptz to Date',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      // Insert test data with ISO string timestamp
      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
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
      expect(row).toMatchObject({
        created_at: new Date('2024-01-15T10:30:00.000Z'),
      });
      expect(row['created_at']).toBeInstanceOf(Date);
    },
    timeouts.databaseOperation,
  );

  it(
    'round-trips numbers correctly',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
        .from(testDataTable)
        .select({
          score: testDataColumns['score']!,
        })
        .build();

      const rows = await executePlanAndCollect(runtime, selectPlan);
      expect(rows.length).toBe(1);

      const row = rows[0]!;
      expect(row).toMatchObject({
        score: 95.5,
      });
      expect(typeof row['score']).toBe('number');
    },
    timeouts.databaseOperation,
  );

  it(
    'round-trips strings correctly',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
        .from(testDataTable)
        .select({
          name: testDataColumns['name']!,
        })
        .build();

      const rows = await executePlanAndCollect(runtime, selectPlan);
      expect(rows.length).toBe(1);

      const row = rows[0]!;
      expect(row).toMatchObject({
        name: 'Test User',
      });
      expect(typeof row['name']).toBe('string');
    },
    timeouts.databaseOperation,
  );

  it(
    'uses codec override via annotations.codecs',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const basePlan = sql({ context })
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
      } as unknown as ExecutionPlan<unknown>;

      const rows = await executePlanAndCollect(runtime, planWithOverride);
      expect(rows.length).toBe(1);

      const row = rows[0]! as Record<string, unknown>;
      expect(row).toMatchObject({
        created_at: expect.anything(),
      });
      expect(row['created_at']).toBeInstanceOf(Date);
    },
    timeouts.databaseOperation,
  );

  it(
    'handles null values correctly',
    async () => {
      // First, alter table to allow nullable created_at for this test
      await client.query('ALTER TABLE test_data ALTER COLUMN created_at DROP NOT NULL');

      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        null,
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
        .from(testDataTable)
        .select({
          created_at: testDataColumns['created_at']!,
        })
        .build();

      const rows = await executePlanAndCollect(runtime, selectPlan);
      expect(rows.length).toBe(1);

      const row = rows[0]!;
      expect(row['created_at']).toBeNull();
    },
    timeouts.databaseOperation,
  );

  it(
    'decodes multiple columns with different types',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const testDataTable = tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const selectPlan = sql({ context })
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
      expect(row).toMatchObject({
        name: 'Test User',
        score: 95.5,
        created_at: expect.any(Date),
      });
      expect(typeof row['name']).toBe('string');
      expect(typeof row['score']).toBe('number');
      expect(row['created_at']).toBeInstanceOf(Date);
    },
    timeouts.databaseOperation,
  );

  it(
    'uses codec assignments from contract column types',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const testDataTable = schema(context).tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const testBuilder = sql({ context });
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
      expect(row).toMatchObject({
        name: 'Test User',
        created_at: expect.any(Date),
      });
      expect(typeof row['name']).toBe('string');
      expect(row['created_at']).toBeInstanceOf(Date);
    },
    timeouts.databaseOperation,
  );

  it(
    'uses codec assignments from contract column types for WHERE clause parameters',
    async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
        },
      );

      await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
        'Test User',
        95.5,
        '2024-01-15T10:30:00.000Z',
      ]);

      const context = createTestContext(fixtureContract, adapter);
      const testDataTable = schema(context).tables['test_data']!;
      const testDataColumns = testDataTable.columns;
      const testBuilder = sql({ context });
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
    },
    timeouts.databaseOperation,
  );
});
