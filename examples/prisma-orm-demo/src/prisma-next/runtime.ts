import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import sqlFamily from '@prisma-next/family-sql/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { budgets, type Runtime } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Client } from 'pg';
import contractJson from './contract.json' with { type: 'json' };

let runtime: Runtime | undefined;
let client: Client | undefined;

export function getPrismaNextRuntime(): Runtime {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Create client but don't connect yet - PostgresDriver will connect lazily on first use
    client = new Client({ connectionString });

    const contract = validateContract(contractJson);

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
        connect: { client },
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
