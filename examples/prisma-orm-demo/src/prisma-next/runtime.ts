import { Client } from 'pg';
import { createRuntime } from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { PostgresDriver } from '@prisma-next/driver-postgres';
import contract from './contract.json' assert { type: 'json' };
import type { DataContract } from '@prisma-next/sql/types';

let runtime: ReturnType<typeof createRuntime> | undefined;
let client: Client | undefined;

export async function getPrismaNextRuntime() {
  if (!runtime) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Use a single client connection for the dev database (supports only one connection)
    client = new Client({ connectionString });
    // Connect the client before creating the driver
    await client.connect();

    const driver = new PostgresDriver({
      connect: { client },
      cursor: { disabled: true },
    });

    runtime = createRuntime({
      contract: contract as DataContract,
      adapter: createPostgresAdapter(),
      driver,
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
    });
  }
  return runtime;
}

export async function closePrismaNextRuntime() {
  if (runtime) {
    await runtime.close();
    runtime = undefined;
  }
  if (client) {
    await client.end();
    client = undefined;
  }
}

