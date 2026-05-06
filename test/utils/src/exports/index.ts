import { type ServerOptions, startPrismaDevServer } from '@prisma/dev';
import { Client } from 'pg';

export * from '../column-descriptors';
export * from '../operation-descriptors';
export * from '../timeouts';

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

export interface DevDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

/**
 * Identifies an isolated real-Postgres database created for one test invocation.
 * Same shape as `DevDatabase`; carried as a distinct type so callers can name
 * the lifecycle they're working with.
 */
export interface RealPostgresDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

export interface RealPostgresOptions {
  /** Override base server URL. Defaults to `PG_TEST_URL` env var or the local CI default. */
  readonly baseConnectionString?: string;
  /** Prefix for the per-invocation database name. Defaults to `'pn_test_'`. */
  readonly databaseNamePrefix?: string;
}

const DEFAULT_REAL_POSTGRES_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const DEFAULT_REAL_POSTGRES_PREFIX = 'pn_test_';

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function createUniqueDatabaseName(prefix: string): string {
  const normalizedPrefix = prefix.replaceAll(/[^a-zA-Z0-9_]/g, '_');
  const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const value = `${normalizedPrefix}${uniqueSuffix}`;
  return value.slice(0, 63);
}

function resolveRealPostgresBaseUrl(options?: RealPostgresOptions): string {
  const candidate =
    options?.baseConnectionString ?? process.env['PG_TEST_URL'] ?? DEFAULT_REAL_POSTGRES_URL;
  return normalizeConnectionString(candidate);
}

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 * @prisma/dev automatically assigns ports to avoid conflicts and enforces a single
 * active connection (second connections are rejected until the first is closed).
 */
export async function createDevDatabase(options?: ServerOptions): Promise<DevDatabase> {
  const server = await startPrismaDevServer({
    databaseConnectTimeoutMillis: 1000,
    databaseIdleTimeoutMillis: 1000,
    ...options,
  });
  return {
    ...server,
    connectionString: normalizeConnectionString(server.database.connectionString),
  };
}

/**
 * Creates a dedicated real-Postgres database for one test invocation.
 *
 * The base server URL defaults to:
 * - `process.env.PG_TEST_URL`, when set
 * - otherwise `postgres://postgres:postgres@127.0.0.1:5432/postgres`
 *
 * The helper creates a unique temporary database, returns its connection string,
 * and drops it on `close()`. Uses `timeouts.spinUpPpgDev` as the matching
 * test-harness timeout (live-Postgres lifecycle is faster than `@prisma/dev`,
 * but the same timeout class keeps test config uniform).
 */
export async function createRealPostgresDatabase(
  options?: RealPostgresOptions,
): Promise<RealPostgresDatabase> {
  const baseConnectionString = resolveRealPostgresBaseUrl(options);
  const prefix = options?.databaseNamePrefix ?? DEFAULT_REAL_POSTGRES_PREFIX;
  const databaseName = createUniqueDatabaseName(prefix);
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const databaseUrl = new URL(baseConnectionString);
  databaseUrl.pathname = `/${databaseName}`;
  const testConnectionString = databaseUrl.toString();

  try {
    await withClient(baseConnectionString, async (client) => {
      await client.query(`CREATE DATABASE ${quotedDatabaseName}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to create test database "${databaseName}" via ${baseConnectionString}. ` +
        `Set PG_TEST_URL to override the base server URL. Root cause: ${message}`,
    );
  }

  let closed = false;
  return {
    connectionString: testConnectionString,
    async close() {
      if (closed) return;
      closed = true;
      await withClient(baseConnectionString, async (client) => {
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [databaseName],
        );
        await client.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
      });
    },
  };
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 * @prisma/dev automatically assigns ports and will reject any attempt to open a
 * second connection while the first is active, so ensure each helper call closes
 * before starting another.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: ServerOptions,
): Promise<T> {
  const database = await createDevDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Executes a function with a temporary real-Postgres database and cleans up.
 * See `createRealPostgresDatabase` for base URL and env-var details.
 */
export async function withRealPostgresDatabase<T>(
  fn: (ctx: RealPostgresDatabase) => Promise<T>,
  options?: RealPostgresOptions,
): Promise<T> {
  const database = await createRealPostgresDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Quick connectivity probe against the base Postgres server. Useful in
 * `beforeAll` blocks to skip integration suites cleanly when no Postgres is
 * reachable (CI ships one as a service; local dev may not).
 */
export async function isRealPostgresReachable(options?: RealPostgresOptions): Promise<boolean> {
  const baseConnectionString = resolveRealPostgresBaseUrl(options);
  try {
    await withClient(baseConnectionString, async (client) => {
      await client.query('SELECT 1');
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes a function with a database client, automatically cleaning up afterward.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drains an async iterable, consuming all values without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

/**
 * Collects all values from an async iterable into an array.
 * Useful for testing query results.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

/**
 * Tears down test database by dropping schema and tables.
 * This helper DRYs up the common pattern of database teardown in tests.
 */
export async function teardownTestDatabase(client: Client, tables?: string[]): Promise<void> {
  if (tables && tables.length > 0) {
    for (const table of tables) {
      await client.query(`drop table if exists "${table}"`);
    }
  }
  await client.query('drop schema if exists prisma_contract cascade');
}
