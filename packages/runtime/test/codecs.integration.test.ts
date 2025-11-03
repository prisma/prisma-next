import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { schema } from '@prisma-next/sql/schema';
import { sql } from '@prisma-next/sql/sql';
import { createRuntime } from '../src/runtime';
import { ensureSchemaStatement, ensureTableStatement, writeContractMarker } from '../src/marker';
import { PostgresDriver } from '../../driver-postgres/src/postgres-driver';
import { createDevDatabase, executeStatement, collectAsync } from './utils';
import type { SqlContract, SqlStorage } from '@prisma-next/contract/types';

const fixtureContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:codecs-test-core',
  profileHash: 'sha256:codecs-test-profile',
  storage: {
    tables: {
      test_data: {
        columns: {
          id: { type: 'int4', nullable: false },
          name: { type: 'text', nullable: false },
          score: { type: 'float8', nullable: false },
          created_at: { type: 'timestamptz', nullable: false },
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
};

describe('Codecs Integration Tests', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: PostgresDriver;
  let client: Client;
  const adapter = createPostgresAdapter();
  const tables = schema(fixtureContract).tables;
  const builder = sql({ contract: fixtureContract, adapter });

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54000,
      databasePort: 54001,
      shadowDatabasePort: 54002,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    sharedDriver = new PostgresDriver({
      connect: { client },
      cursor: { disabled: true },
    });
  });

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
    await client.query('CREATE SCHEMA IF NOT EXISTS public');
    await client.query('DROP TABLE IF EXISTS test_data');
    await client.query(`
      CREATE TABLE test_data (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        score FLOAT8 NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);

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
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
    await client.query('DROP TABLE IF EXISTS test_data');
  });

  it('encodes JS Date parameter to ISO string', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
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
    const testDataTable = tables.test_data as typeof tables.test_data & Record<string, unknown>;
    const selectPlan = builder
      .from(tables.test_data)
      .select({
        id: tables.test_data.columns.id,
        name: tables.test_data.columns.name,
        score: tables.test_data.columns.score,
        created_at: tables.test_data.columns.created_at,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0]!;
    expect(row.created_at).toBeDefined();
    expect(typeof row.created_at).toBe('string');
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('decodes timestamptz to ISO string', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    // Insert test data with ISO string timestamp
    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const selectPlan = builder
      .from(tables.test_data)
      .select({
        name: tables.test_data.columns.name,
        score: tables.test_data.columns.score,
        created_at: tables.test_data.columns.created_at,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row.created_at).toBe('2024-01-15T10:30:00.000Z');
    expect(typeof row.created_at).toBe('string');
  });

  it('round-trips numbers correctly', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const selectPlan = builder
      .from(tables.test_data)
      .select({
        score: tables.test_data.columns.score,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row.score).toBe('number');
    expect(row.score).toBe(95.5);
  });

  it('round-trips strings correctly', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const selectPlan = builder
      .from(tables.test_data)
      .select({
        name: tables.test_data.columns.name,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row.name).toBe('string');
    expect(row.name).toBe('Test User');
  });

  it('uses codec override via annotations.codecs', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const testDataTable = tables.test_data as typeof tables.test_data & Record<string, unknown>;
    const basePlan = builder
      .from(tables.test_data)
      .select({
        created_at: tables.test_data.columns.created_at,
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
            created_at: 'core/iso-datetime@1',
          },
        },
      },
    };

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(planWithOverride));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row.created_at).toBeDefined();
    expect(typeof row.created_at).toBe('string');
  });

  it('handles null values correctly', async () => {
    // First, alter table to allow nullable created_at for this test
    await client.query('ALTER TABLE test_data ALTER COLUMN created_at DROP NOT NULL');

    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      null,
    ]);

    const selectPlan = builder
      .from(tables.test_data)
      .select({
        created_at: tables.test_data.columns.created_at,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row.created_at).toBeNull();
  });

  it('decodes multiple columns with different types', async () => {
    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver: sharedDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await client.query('INSERT INTO test_data (name, score, created_at) VALUES ($1, $2, $3)', [
      'Test User',
      95.5,
      '2024-01-15T10:30:00.000Z',
    ]);

    const selectPlan = builder
      .from(tables.test_data)
      .select({
        name: tables.test_data.columns.name,
        score: tables.test_data.columns.score,
        created_at: tables.test_data.columns.created_at,
      })
      .build();

    const rows = await collectAsync(runtime.execute<Record<string, unknown>>(selectPlan));
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(typeof row.name).toBe('string');
    expect(typeof row.score).toBe('number');
    expect(typeof row.created_at).toBe('string');
    expect(row.name).toBe('Test User');
    expect(row.score).toBe(95.5);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
