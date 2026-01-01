import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
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

            consoleErrors.length = 0;

            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();

            const errorText = stripAnsi(consoleErrors.join('\n'));
            expect(errorText).toContain('PN-RTM-3000');
            expect(errorText).toContain('Issues');
            expect(errorText).toContain('Extra column "user"."name"');
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
              runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']),
            ).rejects.toThrow();

            const errorText = consoleErrors.join('\n').trim();
            const errorJson = JSON.parse(errorText) as Record<string, unknown>;
            expect(errorJson).toMatchObject({
              code: 'PN-CLI-4004',
              domain: 'CLI',
            });
            expect(String(errorJson['fix'])).toContain('contract emit');
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

    describe('connect failure', () => {
      it(
        'returns structured error with --json',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const badUrl = (() => {
              const url = new URL(connectionString);
              url.port = '1';
              return url.toString();
            })();

            consoleOutput.length = 0;
            consoleErrors.length = 0;

            await expect(
              runDbInit(testSetup, [
                '--config',
                configPath,
                '--db',
                badUrl,
                '--json',
                '--no-color',
              ]),
            ).rejects.toThrow();

            expect(consoleOutput.join('\n').trim()).toBe('');

            const errorText = consoleErrors.join('\n').trim();
            const errorJson = JSON.parse(errorText) as Record<string, unknown>;

            expect(errorJson).toMatchObject({
              code: 'PN-RTM-3000',
              domain: 'RTM',
              summary: 'Database connection failed',
              meta: {
                port: '1',
              },
            });

            expect(errorJson).not.toHaveProperty('meta.password');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('marker mismatch', () => {
      it(
        'does not reference non-existent db migrate command',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            await withClient(connectionString, async (client) => {
              await client.query('CREATE SCHEMA IF NOT EXISTS prisma_contract');
              await client.query(`
                CREATE TABLE IF NOT EXISTS prisma_contract.marker (
                  id INTEGER PRIMARY KEY DEFAULT 1,
                  core_hash TEXT NOT NULL,
                  profile_hash TEXT NOT NULL,
                  contract_json JSONB,
                  canonical_version INTEGER,
                  updated_at TIMESTAMPTZ DEFAULT NOW(),
                  app_tag TEXT,
                  meta JSONB DEFAULT '{}'
                )
              `);
              await client.query(`
                INSERT INTO prisma_contract.marker (id, core_hash, profile_hash, contract_json)
                VALUES (1, 'sha256:different-hash', 'sha256:different-profile', '{}')
                ON CONFLICT (id) DO NOTHING
              `);
            });

            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            consoleOutput.length = 0;
            consoleErrors.length = 0;

            await expect(
              runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']),
            ).rejects.toThrow();

            const errorText = consoleErrors.join('\n').trim();
            const errorJson = JSON.parse(errorText) as Record<string, unknown>;

            expect(errorJson).toMatchObject({
              code: 'PN-RTM-3000',
              domain: 'RTM',
              meta: { code: 'MARKER_ORIGIN_MISMATCH' },
            });

            expect(String(errorJson['fix'])).not.toContain('db migrate');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
