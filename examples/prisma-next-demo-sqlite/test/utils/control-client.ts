/**
 * Test utilities using the programmatic control client and runtime.
 *
 * This demonstrates how to use `createControlClient` for test database setup
 * and the runtime for data operations, instead of manual SQL and stampMarker.
 */

import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import type { ContractIR } from '@prisma-next/contract/ir';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sqlitevector from '@prisma-next/extension-sqlite-vector/control';
import sql from '@prisma-next/family-sql/control';
import sqlite from '@prisma-next/target-sqlite/control';

export interface TestControlClientOptions {
  readonly connection: string;
}

/**
 * Creates a control client configured for the demo app's stack.
 *
 * The client auto-connects when operations are called because we provide
 * a default connection in options.
 */
export function createPrismaNextControlClient(options: TestControlClientOptions): ControlClient {
  return createControlClient({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensionPacks: [sqlitevector],
    connection: options.connection,
  });
}

/**
 * Initializes a test database with schema and marker from a contract.
 *
 * This replaces the manual table creation and stampMarker calls.
 * dbInit in 'apply' mode creates all tables/indexes and writes the marker.
 *
 * @example
 * ```typescript
 * await withDevDatabase(async ({ connectionString }) => {
 *   await initTestDatabase({ connection: connectionString, contractIR });
 *   // Database is now ready with schema and marker
 * });
 * ```
 */
export async function initTestDatabase(options: {
  readonly connection: string;
  readonly contractIR: ContractIR;
}): Promise<void> {
  const client = createPrismaNextControlClient({ connection: options.connection });

  try {
    const initResult = await client.dbInit({ contractIR: options.contractIR, mode: 'apply' });
    if (!initResult.ok) {
      throw new Error(`dbInit failed: ${initResult.failure.summary}`);
    }
  } finally {
    await client.close();
  }
}
