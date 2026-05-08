import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseJsonObjectFromCliCapture,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';
import { runDbInit, setupDbInitFixture } from './utils/db-init-test-helpers';

const fixtureSubdir = 'db-init';

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

            const errorJson = parseJsonObjectFromCliCapture(consoleOutput) as Record<
              string,
              unknown
            >;
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

            const errorJson = parseJsonObjectFromCliCapture(consoleOutput) as Record<
              string,
              unknown
            >;

            expect(errorJson).toMatchObject({
              code: 'PN-RUN-3000',
              domain: 'RUN',
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
                  space TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
                  core_hash TEXT NOT NULL,
                  profile_hash TEXT NOT NULL,
                  contract_json JSONB,
                  canonical_version INTEGER,
                  updated_at TIMESTAMPTZ DEFAULT NOW(),
                  app_tag TEXT,
                  meta JSONB DEFAULT '{}',
                  invariants TEXT[] NOT NULL DEFAULT '{}'
                )
              `);
              await client.query(`
                INSERT INTO prisma_contract.marker (space, core_hash, profile_hash, contract_json)
                VALUES ('app', 'sha256:different-hash', 'sha256:different-profile', '{}')
                ON CONFLICT (space) DO NOTHING
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

            const errorJson = parseJsonObjectFromCliCapture(consoleOutput) as Record<
              string,
              unknown
            >;

            expect(errorJson).toMatchObject({
              code: 'PN-RUN-3000',
              domain: 'RUN',
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
