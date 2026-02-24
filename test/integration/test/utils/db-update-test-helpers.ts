import { createDbUpdateCommand } from '../../../../packages/1-framework/3-tooling/cli/src/commands/db-update';
import type { setupTestDirectoryFromFixtures } from './cli-test-helpers';
import { executeCommand, setupDbTestFixture } from './cli-test-helpers';

export type DbUpdateTestSetup = ReturnType<typeof setupTestDirectoryFromFixtures>;

export async function setupDbUpdateFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: DbUpdateTestSetup; configPath: string }> {
  return setupDbTestFixture({
    connectionString,
    createTempDir,
    fixtureSubdir,
    ...(schemaSql ? { schemaSql } : {}),
  });
}

export async function runDbUpdate(
  testSetup: DbUpdateTestSetup,
  args: readonly string[],
): Promise<number> {
  const command = createDbUpdateCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testSetup.testDir);
    return await executeCommand(command, [...args]);
  } finally {
    process.chdir(originalCwd);
  }
}
