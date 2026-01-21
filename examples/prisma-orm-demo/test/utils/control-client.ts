/**
 * Test utilities using the programmatic control client and runtime.
 *
 * This demonstrates how to use `createControlClient` for test database setup
 * and the runtime for data operations.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import type { ContractIR } from '@prisma-next/contract/ir';
import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/runtime';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { budgets, createExecutionContext, createRuntime } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import postgresTargetRuntime from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';

export interface TestControlClientOptions {
  readonly connection: string;
}

/**
 * Creates a control client configured for the prisma-orm-demo stack.
 */
export function createDemoControlClient(options: TestControlClientOptions): ControlClient {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
    connection: options.connection,
  });
}

/**
 * Initializes a test database with schema and marker from a contract.
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
 * Creates a test runtime configured for the prisma-orm-demo stack.
 */
export function createTestRuntime<TContract extends SqlContract<SqlStorage>>(
  connectionString: string,
  contract: TContract,
  budgetConfig?: { maxRows: number; defaultTableRows: number; tableRows: Record<string, number> },
): TestRuntime {
  const stack = createExecutionStack({
    target: postgresTargetRuntime,
    adapter: postgresAdapterRuntime,
    driver: postgresDriverDescriptor,
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({
    contract,
    stack: stackInstance,
  });
  const pool = new Pool({ connectionString });
  const runtime = createRuntime({
    stackInstance,
    contract,
    context,
    driverOptions: {
      connect: { pool },
      cursor: { disabled: true },
    },
    verify: { mode: 'onFirstUse', requireMarker: false },
    plugins: budgetConfig ? [budgets(budgetConfig)] : [],
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
    if (!(pool as { ended?: boolean }).ended) {
      await pool.end();
    }
  }
}
