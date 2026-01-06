import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { ifDefined } from '@prisma-next/utils/defined';
import type { setupTestDirectoryFromFixtures } from './cli-test-helpers';
import { executeCommand, setupDbTestFixture } from './cli-test-helpers';

export type DbInitTestSetup = ReturnType<typeof setupTestDirectoryFromFixtures>;

export async function setupDbInitFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: DbInitTestSetup; configPath: string }> {
  return setupDbTestFixture({
    connectionString,
    createTempDir,
    fixtureSubdir,
    ...ifDefined('schemaSql', schemaSql),
  });
}

export async function runDbInit(
  testSetup: DbInitTestSetup,
  args: readonly string[],
): Promise<number> {
  const command = createDbInitCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testSetup.testDir);
    return await executeCommand(command, [...args]);
  } finally {
    process.chdir(originalCwd);
  }
}
