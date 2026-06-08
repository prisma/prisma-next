import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

/**
 * Init the TS-authored enum contract's schema. Unlike the demo's main contract,
 * the enum contract uses no extension packs, so the control client carries none
 * and no contract-space artefacts need materialising.
 */
export async function initEnumTestDatabase(options: {
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

  const migrationsDir = mkdtempSync(join(tmpdir(), 'prisma-next-demo-enum-migrations-'));
  try {
    mkdirSync(migrationsDir, { recursive: true });
    const initResult = await client.dbInit({
      contract: options.contract,
      mode: 'apply',
      migrationsDir,
    });
    if (!initResult.ok) {
      throw new Error(
        `dbInit failed: ${initResult.failure.summary}\n\n${JSON.stringify(initResult.failure, null, 2)}`,
      );
    }
  } finally {
    await client.close();
    rmSync(migrationsDir, { recursive: true, force: true });
  }
}
