import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupCommandMocks, withTempDir } from './utils/cli-test-helpers';
import { runDbInit, setupDbInitFixture } from './utils/db-init-test-helpers';

// Fixture subdirectory for db-init e2e tests
const fixtureSubdir = 'db-init';

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

    describe('marker idempotency', () => {
      it(
        'succeeds as noop when marker already matches destination contract',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Clear console output
            consoleOutput.length = 0;

            // Second run: should succeed as noop (0 operations applied)
            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);

            // Verify noop - shows "Applied 0 operation(s)" indicating nothing to do
            expect(stripped).toContain('Applied 0 operation');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'succeeds as noop in plan mode when marker already matches destination',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Clear console output
            consoleOutput.length = 0;

            // Second run in plan mode: should succeed as noop with 0 operations
            await runDbInit(testSetup, ['--config', configPath, '--plan', '--no-color']);

            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);

            // Verify it shows 0 planned operations (indicating nothing to do)
            expect(stripped).toContain('Planned 0 operation');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs correct JSON envelope when marker matches destination',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Clear console output
            const outputStartIndex = consoleOutput.length;

            // Second run: should succeed as noop
            await runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']);

            const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
            const jsonOutput = JSON.parse(output) as Record<string, unknown>;

            // Verify structure - should be noop with existing marker
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'apply',
              plan: {
                targetId: expect.any(String),
                destination: {
                  coreHash: expect.any(String),
                },
                operations: [], // Empty - no operations needed
              },
              execution: {
                operationsPlanned: 0,
                operationsExecuted: 0,
              },
              marker: {
                coreHash: expect.any(String),
                profileHash: expect.any(String),
              },
              summary: 'Database already at target contract state',
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'fails when marker exists but does not match destination contract',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First: set up database with marker from a different contract
            // We'll manually create a marker with a different hash
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

            // Should fail with MARKER_ORIGIN_MISMATCH
            await expect(
              runDbInit(testSetup, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('does not match plan destination');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'fails in plan mode when marker exists but does not match destination',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First: set up database with marker from a different contract
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

            // Should fail with MARKER_ORIGIN_MISMATCH even in plan mode
            await expect(
              runDbInit(testSetup, ['--config', configPath, '--plan', '--no-color']),
            ).rejects.toThrow();

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('does not match plan destination');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
