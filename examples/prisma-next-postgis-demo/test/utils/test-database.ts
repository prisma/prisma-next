/**
 * Test database utilities — talks to the PostgreSQL+PostGIS instance
 * defined in `docker-compose.yml`. The e2e suite skips entirely when the
 * server isn't reachable so a clean clone of the repo doesn't fail
 * unexpectedly; you opt in by running `pnpm db:up`.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgis from '@prisma-next/extension-postgis/control';
import sql from '@prisma-next/family-sql/control';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { type CreateRuntimeOptions, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5435/postgis_demo';

/**
 * Probe the test database. Returns true only if the connection succeeds
 * AND the postgis extension is available. We use this to gate the
 * integration suite so missing-Docker is a skip, not a failure.
 */
export async function isPostgisAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: TEST_DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM pg_available_extensions WHERE name = 'postgis'",
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function createPostgisControlClient(connection: string): ControlClient {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [postgis],
    connection,
  });
}

/**
 * Drop+recreate the public schema, then run `dbInit` to apply the contract
 * (which also re-creates the postgis extension dependency declaration).
 */
export async function resetTestDatabase(contract: unknown): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  } finally {
    await client.end();
  }

  const controlClient = createPostgisControlClient(TEST_DATABASE_URL);
  try {
    const result = await controlClient.dbInit({ contract, mode: 'apply' });
    if (!result.ok) {
      throw new Error(
        `dbInit failed: ${result.failure.summary}\n\n${JSON.stringify(result.failure, null, 2)}`,
      );
    }
  } finally {
    await controlClient.close();
  }
}

export async function buildTestRuntime(
  executionStack: unknown,
  context: unknown,
): Promise<Runtime> {
  const stackInstance = instantiateExecutionStack(
    executionStack as Parameters<typeof instantiateExecutionStack>[0],
  ) as CreateRuntimeOptions['stackInstance'];
  const driver = stackInstance.driver as unknown as SqlDriver<unknown>;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
  return createRuntime({
    stackInstance,
    context: context as CreateRuntimeOptions['context'],
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
}
