import { Client } from 'pg';
import { createRuntime, budgets } from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { validateContract } from '@prisma-next/sql-query/schema';
import contractJson from './contract.json' assert { type: 'json' };
import type { Contract } from './contract.d';

let runtime: ReturnType<typeof createRuntime> | undefined;
let client: Client | undefined;

export function getRuntime() {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const contract = validateContract<Contract>(contractJson);

    client = new Client({ connectionString });

    const driver = createPostgresDriverFromOptions({
      connect: { client },
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
  if (client) {
    await client.end();
    client = undefined;
  }
}

