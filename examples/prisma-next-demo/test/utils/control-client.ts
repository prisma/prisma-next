/**
 * Test utilities using the programmatic control client and runtime.
 *
 * This demonstrates how to use `createControlClient` for test database setup
 * and the runtime for data operations, instead of manual SQL and stampMarker.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

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
 *   await initTestDatabase({ connection: connectionString, contract });
 *   // Database is now ready with schema and marker
 * });
 * ```
 */
export async function initTestDatabase(options: {
  readonly connection: string;
  readonly contract: unknown;
  /**
   * On-disk migrations directory. The demo app does not declare any
   * extension contract spaces, so the per-space `db init` flow runs
   * with the n=1 (app-only) resolver list and does not actually read
   * from this path — but `migrationsDir` is required by the API.
   */
  readonly migrationsDir?: string;
}): Promise<void> {
  const client = createPrismaNextControlClient({ connection: options.connection });

  try {
    const initResult = await client.dbInit({
      contract: options.contract,
      mode: 'apply',
      migrationsDir: options.migrationsDir ?? '/tmp/__prisma-next-test-migrations',
    });
    if (!initResult.ok) {
      throw new Error(
        `dbInit failed: ${initResult.failure.summary}\n\n${JSON.stringify(initResult.failure, null, 2)}`,
      );
    }
  } finally {
    await client.close();
  }
}
