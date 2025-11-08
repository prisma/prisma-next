import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { budgets, createRuntime } from '@prisma-next/runtime';
import { validateContract } from '@prisma-next/sql-query/schema';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

let runtime: ReturnType<typeof createRuntime> | undefined;
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

    runtime = createRuntime({
      contract,
      adapter: createPostgresAdapter(),
      driver,
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
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
