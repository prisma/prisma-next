import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { ifDefined } from '@prisma-next/utils/defined';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupDbTestFixture,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-init e2e tests
const fixtureSubdir = 'db-init';

/**
 * Sets up a test directory for db-init e2e tests.
 * Optionally creates a database schema. By default, creates an empty database.
 */
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
    ...ifDefined('schemaSql', schemaSql),
  });
}

/**
 * Runs the db-init command with the given arguments.
 * Handles process.chdir and restores the original working directory.
 */
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
  describe('db init command (e2e)', () => {
    let consoleOutput: string[] = [];
    let consoleErrors: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      // Set up console and process.exit mocks
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      consoleErrors = mocks.consoleErrors;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    describe('empty database (happy path)', () => {
      it(
        'applies migration plan to empty database',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // Set up with empty database (no schema)
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Get output and strip ANSI for verification
            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);

            // Verify success message
            expect(stripped).toContain('Applied');
            expect(stripped).toContain('operation');

            // Verify marker was created in database
            await withClient(connectionString, async (client) => {
              const result = await client.query(
                'select core_hash, profile_hash from prisma_contract.marker where id = $1',
                [1],
              );
              expect(result.rows.length).toBe(1);
              expect(result.rows[0]?.core_hash).toBeDefined();
            });

            // Verify table was created
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user'
              `);
              expect(result.rows.length).toBe(1);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs JSON envelope in apply mode',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            // Clear console output before running the command we want to test
            const outputStartIndex = consoleOutput.length;

            await runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']);

            // Get output and parse JSON (only from this command)
            const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
            const jsonOutput = JSON.parse(output) as Record<string, unknown>;

            // Verify structure
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'apply',
              plan: {
                targetId: expect.any(String),
                destination: {
                  coreHash: expect.any(String),
                },
                operations: expect.any(Array),
              },
              execution: {
                operationsPlanned: expect.any(Number),
                operationsExecuted: expect.any(Number),
              },
              marker: {
                coreHash: expect.any(String),
              },
              summary: expect.any(String),
              timings: {
                total: expect.any(Number),
              },
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('plan mode (--plan)', () => {
      it(
        'shows planned operations without applying',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--plan', '--no-color']);

            // Get output and strip ANSI for verification
            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);

            // Verify plan output
            expect(stripped).toContain('Planned');
            expect(stripped).toContain('operation');
            expect(stripped).toContain('dry run');

            // Verify no changes were made to database
            await withClient(connectionString, async (client) => {
              // Table should NOT exist
              const tableResult = await client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user'
              `);
              expect(tableResult.rows.length).toBe(0);

              // Marker should NOT exist
              const schemaResult = await client.query(`
                SELECT schema_name FROM information_schema.schemata
                WHERE schema_name = 'prisma_contract'
              `);
              expect(schemaResult.rows.length).toBe(0);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs JSON envelope in plan mode',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const outputStartIndex = consoleOutput.length;

            await runDbInit(testSetup, ['--config', configPath, '--plan', '--json', '--no-color']);

            const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
            const jsonOutput = JSON.parse(output) as Record<string, unknown>;

            // Verify structure
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'plan',
              plan: {
                targetId: expect.any(String),
                destination: {
                  coreHash: expect.any(String),
                },
                operations: expect.any(Array),
              },
              summary: expect.any(String),
              timings: {
                total: expect.any(Number),
              },
            });

            // Verify no execution in plan mode
            expect(jsonOutput).not.toHaveProperty('execution');
            expect(jsonOutput).not.toHaveProperty('marker');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('non-empty database (conflicts)', () => {
      it(
        'fails when database has existing schema that conflicts',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // Create a conflicting table (same name but different structure)
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

            // db init should fail because table already exists with different columns
            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();

            // Verify error was reported
            expect(getExitCode()).not.toBe(0);
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

            // Don't emit contract - it should be missing
            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();

            // Verify error output
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

            // In quiet mode, success output should be minimal
            const output = consoleOutput.join('\n');
            expect(output).not.toContain('Bootstrap');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
