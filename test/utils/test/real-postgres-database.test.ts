import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createRealPostgresDatabase,
  isRealPostgresReachable,
  withClient,
  withRealPostgresDatabase,
} from '../src/exports/index';
import { timeouts } from '../src/timeouts';

const baseUrl =
  process.env['PG_TEST_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

// Top-level await: probe at module load so describe.skipIf sees the resolved value.
// `it.skipIf(...)` with a let-bound flag from beforeAll does not work — vitest evaluates
// skip conditions at test-registration time, not at run time.
const reachable = await isRealPostgresReachable();

describe.skipIf(!reachable)('real-postgres test harness', () => {
  it(
    'creates a fresh database, queries it, and drops it on close',
    async () => {
      const database = await createRealPostgresDatabase();
      try {
        await withClient(database.connectionString, async (client) => {
          const { rows } = await client.query<{ x: number }>('SELECT 1::int AS x');
          expect(rows[0]?.x).toBe(1);
          const dbName = await client.query<{ name: string }>('SELECT current_database() AS name');
          expect(dbName.rows[0]?.name).toMatch(/^pn_test_/);
        });
      } finally {
        await database.close();
      }

      const droppedName = new URL(database.connectionString).pathname.replace(/^\//, '');
      const baseClient = new Client({ connectionString: baseUrl });
      await baseClient.connect();
      try {
        const { rows } = await baseClient.query<{ exists: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
          [droppedName],
        );
        expect(rows[0]?.exists).toBe(false);
      } finally {
        await baseClient.end();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'assigns unique database names across invocations',
    async () => {
      const a = await createRealPostgresDatabase();
      const b = await createRealPostgresDatabase();
      try {
        expect(a.connectionString).not.toBe(b.connectionString);
      } finally {
        await a.close();
        await b.close();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'honours databaseNamePrefix override',
    async () => {
      const database = await createRealPostgresDatabase({ databaseNamePrefix: 'harness_demo_' });
      try {
        const dbName = new URL(database.connectionString).pathname.replace(/^\//, '');
        expect(dbName).toMatch(/^harness_demo_/);
      } finally {
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'honours baseConnectionString override',
    async () => {
      const database = await createRealPostgresDatabase({ baseConnectionString: baseUrl });
      try {
        const url = new URL(database.connectionString);
        const baseHost = new URL(baseUrl).hostname;
        const expectedHost =
          baseHost === 'localhost' || baseHost === '::1' ? '127.0.0.1' : baseHost;
        expect(url.hostname).toBe(expectedHost);
      } finally {
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'cleans up the database when the user fn throws inside withRealPostgresDatabase',
    async () => {
      let observedName: string | undefined;

      await expect(
        withRealPostgresDatabase(async ({ connectionString }) => {
          observedName = new URL(connectionString).pathname.replace(/^\//, '');
          throw new Error('user fn boom');
        }),
      ).rejects.toThrow('user fn boom');

      expect(observedName).toBeDefined();
      const baseClient = new Client({ connectionString: baseUrl });
      await baseClient.connect();
      try {
        const { rows } = await baseClient.query<{ exists: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
          [observedName ?? ''],
        );
        expect(rows[0]?.exists).toBe(false);
      } finally {
        await baseClient.end();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'fails fast with a clear error when the base server is unreachable',
    async () => {
      const unreachable = 'postgres://postgres:postgres@127.0.0.1:1/postgres';
      await expect(
        createRealPostgresDatabase({ baseConnectionString: unreachable }),
      ).rejects.toThrow(/Failed to create test database/);
    },
    timeouts.spinUpPpgDev,
  );
});
