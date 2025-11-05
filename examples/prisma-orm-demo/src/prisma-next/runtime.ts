import { Client } from 'pg';
import { createRuntime, budgets } from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import contractJson from './contract.json' assert { type: 'json' };
import { validateContract } from '@prisma-next/sql/schema';

let runtime: ReturnType<typeof createRuntime> | undefined;
let client: Client | undefined;

export function getPrismaNextRuntime() {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Create client but don't connect yet - PostgresDriver will connect lazily on first use
    client = new Client({ connectionString });

    const driver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { disabled: true },
    });

    runtime = createRuntime({
      contract: validateContract(contractJson),
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
          tableRows: { user: 10_000 },
          maxLatencyMs: 1_000,
        }),
      ],
    });
  }
  return runtime;
}

export async function closePrismaNextRuntime() {
  if (runtime) {
    // Note: runtime.close() doesn't disconnect direct clients, only pools
    // This allows tests to manage their own client connections
    await runtime.close();
    runtime = undefined;
  }
  if (client) {
    await client.end();
    client = undefined;
  }
}
