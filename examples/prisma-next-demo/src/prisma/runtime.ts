import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/runtime';
import { validateContract } from '@prisma-next/sql-query/schema';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

let runtime: ReturnType<typeof createRuntime> | undefined;
let context: ReturnType<typeof createRuntimeContext> | undefined;
let pool: Pool | undefined;

export function getRuntime() {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const contract = validateContract<Contract>(contractJson);

    pool = new Pool({ connectionString });

    const driver = createPostgresDriverFromOptions({
      connect: { pool },
      cursor: { disabled: true },
    });

    const adapter = createPostgresAdapter();

    // Create context with contract and adapter (adapter provides codecs via profile.codecs())
    // Extensions can be added programmatically when available
    context = createRuntimeContext({
      contract,
      adapter,
      extensions: [],
    });

    runtime = createRuntime({
      adapter,
      driver,
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
      context,
      plugins: [
        budgets({
          maxRows: 10_000,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000, post: 10_000 },
          maxLatencyMs: 1_000,
        }),
      ],
    });
  }
  return runtime;
}

export function getContext() {
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
}
