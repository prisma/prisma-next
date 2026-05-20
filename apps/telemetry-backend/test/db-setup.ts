import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { executeDbInit } from '@prisma-next/cli/control-api';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const contract = contractJson as Contract;
const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
] as const;

function createFamilyInstance() {
  return sqlFamilyDescriptor.create(
    createControlStack({
      family: sqlFamilyDescriptor,
      target: postgresTargetDescriptor,
      adapter: postgresAdapterDescriptor,
      driver: postgresDriverDescriptor,
      extensionPacks: [],
    }),
  );
}

export async function resetTelemetrySchema(connectionString: string): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'telemetry-backend-schema-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  const driver = await postgresDriverDescriptor.create(connectionString);
  try {
    await driver.query('drop schema if exists public cascade');
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('create schema public');

    const result = await executeDbInit({
      driver,
      familyInstance: createFamilyInstance(),
      contract,
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
    await driver.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
}
