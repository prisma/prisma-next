import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { Client } from 'pg';
import contractJson from './contract.json' with { type: 'json' };

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

    const contract = validateContract(contractJson);
    const adapter = createPostgresAdapter();
    const context = createRuntimeContext({ contract, adapter, extensions: [] });

    runtime = createRuntime({
      context,
      adapter,
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
