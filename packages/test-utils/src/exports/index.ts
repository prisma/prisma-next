import type { StartServerOptions } from '@prisma/dev';
import { unstable_startServer } from '@prisma/dev';
import { Client } from 'pg';

function normalizeConnectionString(raw: string): string {
  // eslint-disable-next-line no-undef
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
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 */
export async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const server = await unstable_startServer(options);
  return {
    connectionString: normalizeConnectionString(server.database.connectionString),
    async close() {
      await server.close();
    },
  };
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: StartServerOptions,
): Promise<T> {
  const database = await createDevDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
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
