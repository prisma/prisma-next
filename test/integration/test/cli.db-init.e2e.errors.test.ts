import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  setupCommandMocks,
  setupDbTestFixture,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const fixtureSubdir = 'db-init';

async function setupDbInitFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>; configPath: string }> {
  return setupDbTestFixture({
    connectionString,
    createTempDir,
    fixtureSubdir,
    ...(schemaSql ? { schemaSql } : {}),
  });
}

async function runDbInit(
  testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>,
  args: string[],
): Promise<number> {
  const command = createDbInitCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testSetup.testDir);
    return await executeCommand(command, args);
  } finally {
    process.chdir(originalCwd);
  }
}

withTempDir(({ createTempDir }) => {
  describe('db init command (e2e) - errors', () => {
    let consoleOutput: string[] = [];
    let consoleErrors: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      consoleErrors = mocks.consoleErrors;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    describe('non-empty database (conflicts)', () => {
      it(
        'fails when database has existing schema that conflicts',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
              `
                CREATE TABLE IF NOT EXISTS "user" (
                  id SERIAL PRIMARY KEY,
                  name TEXT NOT NULL
                )
              `,
            );

            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('error handling', () => {
      it(
        'handles missing contract file',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const configPath = testSetup.configPath;

            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('PN-CLI-4');
            expect(errorOutput).toMatch(/file.*not found|not found.*file/i);
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'handles quiet mode flag',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--quiet', '--no-color']);

            const output = stripAnsi(consoleOutput.join('\n'));
            expect(output).not.toContain('Bootstrap');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('--json ndjson', () => {
      it(
        'rejects ndjson output mode',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            // setupDbTestFixture emits the contract and logs to console; clear so we only assert on db init output
            consoleOutput.length = 0;
            consoleErrors.length = 0;

            await expect(
              runDbInit(testSetup, ['--config', configPath, '--json', 'ndjson', '--no-color']),
            ).rejects.toThrow();

            expect(consoleOutput.join('\n').trim()).toBe('');

            const errorText = consoleErrors.join('\n').trim();
            const errorJson = JSON.parse(errorText) as Record<string, unknown>;
            expect(errorJson).toMatchObject({
              domain: 'CLI',
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
