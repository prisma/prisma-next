import { unstable_startServer } from '@prisma/dev';
import type { StartServerOptions } from '@prisma/dev';
import { Client } from 'pg';

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

import type { SqlStatement } from '../src/marker';

export interface DevDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

export async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const server = await unstable_startServer(options);

  return {
    connectionString: normalizeConnectionString(server.database.connectionString),
    async close() {
      await server.close();
    },
  };
}

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

export async function executeStatement(client: Client, statement: SqlStatement) {
  if (statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }

  await client.query(statement.sql);
}

export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}
