import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export async function initTestDatabase(options: {
  readonly connection: string;
  readonly contract: unknown;
}): Promise<void> {
  const client = createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    connection: options.connection,
  });

  const migrationsDir = mkdtempSync(join(tmpdir(), 'prisma-next-enum-demo-'));
  mkdirSync(migrationsDir, { recursive: true });
  try {
    const result = await client.dbInit({
      contract: options.contract,
      mode: 'apply',
      migrationsDir,
    });
    if (!result.ok) {
      throw new Error(`dbInit failed: ${result.failure.summary}`);
    }
  } finally {
    await client.close();
    rmSync(migrationsDir, { recursive: true, force: true });
  }
}
