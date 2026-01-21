/**
 * Test utilities using the programmatic control client and runtime.
 *
 * This demonstrates how to use `createControlClient` for test database setup
 * and the runtime for data operations, instead of manual SQL and stampMarker.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import type { ContractIR } from '@prisma-next/contract/ir';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export { getRuntime } from '../../src/prisma/runtime';

export interface TestControlClientOptions {
  readonly connection: string;
}

/**
 * Creates a control client configured for the demo app's stack.
 *
 * The client auto-connects when operations are called because we provide
 * a default connection in options.
 */
export function createDemoControlClient(options: TestControlClientOptions): ControlClient {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [pgvector],
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
  const client = createDemoControlClient({ connection: options.connection });

  try {
    const initResult = await client.dbInit({ contractIR: options.contractIR, mode: 'apply' });
    if (!initResult.ok) {
      throw new Error(`dbInit failed: ${initResult.failure.summary}`);
    }
  } finally {
    await client.close();
  }
}
