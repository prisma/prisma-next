import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/runtime';
import { validateContract } from '@prisma-next/sql-query/schema';
import { Client } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

let runtime: ReturnType<typeof createRuntime> | undefined;
let context: ReturnType<typeof createRuntimeContext> | undefined;
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

    const adapter = createPostgresAdapter();

    // Create context with adapter (adapter provides codecs via profile.codecs())
    // Extensions can be added programmatically when available
    context = createRuntimeContext({
      adapter,
      extensions: [],
    });

    runtime = createRuntime({
      contract,
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
  if (client) {
    await client.end();
    client = undefined;
  }
}
