/**
 * Test utilities using the programmatic control client.
 *
 * This demonstrates how to use `createControlClient` for test database setup
 * (table creation + marker stamping) for the SQLite target.
 */
import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sql from '@prisma-next/family-sql/control';
import sqlite from '@prisma-next/target-sqlite/control';

export interface TestControlClientOptions {
  readonly connection: string;
}

export function createPrismaNextControlClient(options: TestControlClientOptions): ControlClient {
  return createControlClient({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    connection: options.connection,
  });
}

/**
 * Initializes a test database with schema and marker from a contract.
 *
 * dbInit in 'apply' mode creates all tables/indexes and writes the marker.
 */
export async function initTestDatabase(options: {
  readonly connection: string;
  readonly contract: unknown;
}): Promise<void> {
  const client = createPrismaNextControlClient({ connection: options.connection });

  try {
    const initResult = await client.dbInit({ contract: options.contract, mode: 'apply' });
    if (!initResult.ok) {
      throw new Error(
        `dbInit failed: ${initResult.failure.summary}\n\n${JSON.stringify(initResult.failure, null, 2)}`,
      );
    }
  } finally {
    await client.close();
  }
}
