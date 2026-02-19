import { readFile } from 'node:fs/promises';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { Client } from 'pg';

function createControlClientForTests(connectionString: string): ControlClient {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
    connection: connectionString,
  });
}

async function loadContractIRFromDisk(contractJsonPath: string): Promise<Record<string, unknown>> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(contractJsonContent) as Record<string, unknown>;
}

async function resetDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await client.query('CREATE SCHEMA "public"');
  } finally {
    await client.end();
  }
}

export async function getPlannedDdlSql(options: {
  readonly connectionString: string;
  readonly contractJsonPath: string;
}): Promise<string> {
  const { connectionString, contractJsonPath } = options;
  const contractIR = await loadContractIRFromDisk(contractJsonPath);
  await resetDatabase(connectionString);
  const controlClient = createControlClientForTests(connectionString);
  type OperationWithSqlSteps = {
    readonly execute: ReadonlyArray<{ readonly sql: string }>;
  };

  try {
    const result = await controlClient.dbInit({
      contractIR,
      mode: 'plan',
      connection: connectionString,
    });
    if (!result.ok) {
      throw new Error(`dbInit plan failed: ${result.failure.summary}`);
    }

    const operations = result.value.plan
      .operations as unknown as ReadonlyArray<OperationWithSqlSteps>;
    return operations
      .flatMap((operation) => operation.execute.map((step) => step.sql))
      .join(';\n\n');
  } finally {
    await controlClient.close();
  }
}
