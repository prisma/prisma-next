import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { executeDbInit } from '@prisma-next/cli/control-api';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { join } from 'pathe';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
] as const;

function createTestControlStack() {
  return createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [],
  });
}

export async function resetTelemetrySchema(connectionString: string): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'telemetry-backend-schema-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  let driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>> | undefined;
  try {
    driver = await postgresDriverDescriptor.create(connectionString);
    await driver.query('drop schema if exists public cascade');
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('create schema public');

    const controlStack = createTestControlStack();
    const familyInstance = sqlFamilyDescriptor.create(controlStack);
    const adapter = postgresAdapterDescriptor.create(controlStack);
    const result = await executeDbInit({
      driver,
      adapter,
      familyInstance,
      contract: familyInstance.deserializeContract(contractJson),
      mode: 'apply',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir,
      targetId: 'postgres',
      extensionPacks: [],
    });

    if (!result.ok) {
      throw new Error(`Telemetry schema init failed: ${JSON.stringify(result.failure)}`);
    }
  } finally {
    if (driver !== undefined) {
      await driver.close();
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
}
