import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import sqlFamily from '@prisma-next/family-sql/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import {
  budgets,
  createRuntimeContext,
  type Runtime,
  type RuntimeContext,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

let runtime: Runtime | undefined;
let context: RuntimeContext<Contract> | undefined;
let pool: Pool | undefined;

export function getRuntime(): Runtime {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const contract = validateContract<Contract>(contractJson);

    pool = new Pool({ connectionString });

    // Create extension instance (reused for both runtime and context)
    const pgvectorExt = pgvector();

    // Create runtime family instance from descriptors
    const familyInstance = sqlFamily.create({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensionPacks: [],
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
      extensionPacks: [pgvectorExt],
      plugins: [
        budgets({
          maxRows: 10_000,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000, post: 10_000 },
          maxLatencyMs: 1_000,
        }),
      ],
    });

    // Create context for schema/query builders (adapter and extensions from family instance)
    const adapterInstance = postgresAdapter.create();
    context = createRuntimeContext({
      contract,
      adapter: adapterInstance,
      extensionPacks: [pgvectorExt],
    });
  }
  return runtime;
}

export function getContext(): RuntimeContext<Contract> {
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
