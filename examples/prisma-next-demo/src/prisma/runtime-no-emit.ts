import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import sqlFamily from '@prisma-next/family-sql/runtime';
import {
  budgets,
  createRuntimeContext,
  type Runtime,
  type RuntimeContext,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import { contract } from '../../prisma/contract';

let runtime: Runtime | undefined;
let context: RuntimeContext<typeof contract> | undefined;
let pool: Pool | undefined;

export function getRuntime(): Runtime {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Use contract directly from TypeScript - no emit needed!
    // The contract is already validated at build time via the builder API

    pool = new Pool({ connectionString });

    // Create runtime family instance from descriptors
    const familyInstance = sqlFamily.create({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    });

    // Create runtime using family instance
    runtime = familyInstance.createRuntime({
      contract,
      driverOptions: {
        connect: { pool },
        cursor: { disabled: true },
      },
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
      extensionPacks: [],
      plugins: [
        budgets({
          maxRows: 10_000,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000, post: 10_000 },
          maxLatencyMs: 1_000,
        }),
      ],
    });

    // Create context for schema/query builders (adapter from descriptor)
    const adapterInstance = postgresAdapter.create();
    context = createRuntimeContext({
      contract,
      adapter: adapterInstance,
      extensionPacks: [],
    });
  }
  return runtime;
}

export function getContext(): RuntimeContext<typeof contract> {
  if (!context) {
    getRuntime();
  }
  if (!context) {
    throw new Error('Context not initialized');
  }
  return context;
}

export async function closeRuntime() {
  if (runtime) {
    await runtime.close();
    runtime = undefined;
  }
  // Pool is closed by runtime.close() -> driver.close(), so we just clear the reference
  if (pool) {
    pool = undefined;
  }
  // Clear context reference as well
  context = undefined;
}
