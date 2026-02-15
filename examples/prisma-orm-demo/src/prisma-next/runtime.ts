import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  budgets,
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Client } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

let runtime: Runtime | undefined;
let client: Client | undefined;

export async function getPrismaNextRuntime(): Promise<Runtime> {
  if (!runtime) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    client = new Client({ connectionString });

    const contract = validateContract<Contract>(contractJson);

    const stack = createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensionPacks: [],
    });

    const stackInstance = instantiateExecutionStack(stack);

    const context = createExecutionContext({
      contract,
      stack,
    });

    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new Error('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({ cursor: { disabled: true } });
    await driver.connect({ kind: 'pgClient', client });

    runtime = createRuntime({
      stackInstance,
      context,
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
    await runtime.close();
    runtime = undefined;
  }
  if (client) {
    await client.end();
    client = undefined;
  }
}
