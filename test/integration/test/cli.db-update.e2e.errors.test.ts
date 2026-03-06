import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupCommandMocks, withTempDir } from './utils/cli-test-helpers';
import { runDbInit } from './utils/db-init-test-helpers';
import { runDbUpdate, setupDbUpdateFixture } from './utils/db-update-test-helpers';

const fixtureSubdir = 'db-init';

withTempDir(({ createTempDir }) => {
  describe('db update command (e2e) - errors', () => {
    let consoleErrors: string[] = [];
    let consoleOutput: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      const mocks = setupCommandMocks();
      consoleErrors = mocks.consoleErrors;
      consoleOutput = mocks.consoleOutput;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it(
      'succeeds on a fresh database without prior db init',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          // db update should work on a fresh database without db init
          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--plan', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'rejects ndjson format',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await expect(
            runDbUpdate(testSetup, ['--config', configPath, '--json', 'ndjson', '--no-color']),
          ).rejects.toThrow();

          const errorText = consoleErrors.join('\n').trim();
          const errorJson = JSON.parse(errorText) as Record<string, unknown>;
          expect(errorJson).toMatchObject({
            domain: 'CLI',
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles divergent database with extra column by planning destructive drop',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          // Init the database with the contract
          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Manually add an extra column not in the contract (simulate drift)
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."user" ADD COLUMN "legacy_notes" text');
          });

          // db update should detect the extra column and plan a destructive drop
          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--plan', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('legacy_notes');
          expect(planOutput).toContain('destructive');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
