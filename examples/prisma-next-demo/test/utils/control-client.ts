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
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import { Pool } from 'pg';
import {
  pgvectorExtensionRuntimeDescriptor,
  postgresAdapterRuntimeDescriptor,
  postgresTargetRuntimeDescriptor,
} from './framework-components.ts';

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

export interface TestRuntime {
  readonly runtime: ReturnType<typeof createRuntime>;
  readonly pool: Pool;
}

/**
 * Creates a test runtime configured for the demo app's stack.
 *
 * @example
 * ```typescript
 * const { runtime, pool } = createTestRuntime(connectionString, contract);
 * try {
 *   // Use runtime...
 * } finally {
 *   await closeTestRuntime({ runtime, pool });
 * }
 * ```
 */
export function createTestRuntime<TContract extends SqlContract>(
  connectionString: string,
  contract: TContract,
): TestRuntime {
  const context = createRuntimeContext({
    contract,
    target: postgresTargetRuntimeDescriptor,
    adapter: postgresAdapterRuntimeDescriptor,
    extensionPacks: [pgvectorExtensionRuntimeDescriptor],
  });
  const pool = new Pool({ connectionString });
  const driver = createPostgresDriverFromOptions({
    connect: { pool },
    cursor: { disabled: true },
  });
  const runtime = createRuntime({
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
    plugins: [
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
      }),
    ],
  });
  return { runtime, pool };
}

/**
 * Closes the test runtime and pool.
 */
export async function closeTestRuntime({ runtime, pool }: TestRuntime): Promise<void> {
  try {
    await runtime.close();
  } finally {
    // Only close pool if runtime.close() didn't already close it
    if (!(pool as { ended?: boolean }).ended) {
      await pool.end();
    }
  }
}
