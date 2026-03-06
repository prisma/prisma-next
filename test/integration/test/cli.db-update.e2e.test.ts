import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  fixtureAppDir,
  setupCommandMocks,
  withTempDir,
} from './utils/cli-test-helpers';
import { runDbInit } from './utils/db-init-test-helpers';
import {
  runDbUpdate,
  runDbUpdateAllowFailure,
  setupDbUpdateFixture,
} from './utils/db-update-test-helpers';

const fixtureSubdir = 'db-init';

function addNicknameColumnToContract(testDir: string): void {
  const contractPath = join(testDir, 'contract.ts');
  const contractSource = readFileSync(contractPath, 'utf-8');
  const updatedSource = contractSource.replace(
    ".column('email', { type: textColumn, nullable: false })",
    ".column('email', { type: textColumn, nullable: false })\n      .column('nickname', { type: textColumn, nullable: true })",
  );
  writeFileSync(contractPath, updatedSource, 'utf-8');
}

withTempDir(({ createTempDir }) => {
  describe('db update command (e2e)', () => {
    let consoleOutput: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it(
      'is a no-op when database already matches current contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          // Init the database with the contract
          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Run db update immediately without changing the contract
          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned 0 operation(s)');

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);
          const applyOutput = stripAnsi(consoleOutput.join('\n'));
          expect(applyOutput).toContain('Database already matches contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'plans and applies contract changes from signed state',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          addNicknameColumnToContract(testSetup.testDir);
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned');
          expect(planOutput).toContain('nickname');
          expect(planOutput).toContain('DDL preview');

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);
          const applyOutput = stripAnsi(consoleOutput.join('\n'));
          expect(applyOutput).toContain('Applied');

          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'user'
                AND column_name = 'nickname'
            `);
            expect(columnResult.rows.length).toBe(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns JSON envelope in plan mode',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          addNicknameColumnToContract(testSetup.testDir);

          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const outputStart = consoleOutput.length;
          await runDbUpdate(testSetup, [
            '--config',
            configPath,
            '--dry-run',
            '--json',
            '--no-color',
          ]);
          const output = consoleOutput.slice(outputStart).join('\n').trim();
          const payload = JSON.parse(output) as Record<string, unknown>;

          expect(payload).toMatchObject({
            ok: true,
            mode: 'plan',
            plan: {
              targetId: expect.any(String),
              destination: { storageHash: expect.any(String) },
              operations: expect.any(Array),
              sql: expect.any(Array),
            },
          });

          const sqlPreview = (payload as { plan?: { sql?: unknown[] } }).plan?.sql ?? [];
          expect(sqlPreview.length).toBeGreaterThan(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});

// ---------------------------------------------------------------------------
// Rich account/project reconciliation scenarios
// ---------------------------------------------------------------------------

const scenarioFixtureSubdir = 'db-update-scenarios';

/**
 * Switches the contract from v1 to v2 by copying contract-v2.ts over contract.ts,
 * then re-emitting the contract.
 */
async function switchToContractV2(testDir: string, configPath: string): Promise<void> {
  const v2Source = join(fixtureAppDir, 'fixtures', scenarioFixtureSubdir, 'contract-v2.ts');
  const contractDest = join(testDir, 'contract.ts');
  copyFileSync(v2Source, contractDest);

  const emitCommand = createContractEmitCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
    await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
  } finally {
    process.chdir(originalCwd);
  }
}

withTempDir(({ createTempDir }) => {
  describe('db update scenarios', () => {
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

    // Scenario 1: Fresh database without prior db init
    it(
      'succeeds on a fresh database without prior db init',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          // db update should work on a fresh database without db init
          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 2: Preview a contract change (plan mode)
    it(
      'previews contract change in plan mode without applying',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToContractV2(testSetup.testDir, configPath);

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));

          expect(planOutput).toContain('Planned');
          expect(planOutput).toContain('slug');
          expect(planOutput).toContain('dry run');

          // Verify no changes applied to database
          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'project'
                AND column_name = 'slug'
            `);
            expect(columnResult.rows.length).toBe(0);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 3: Apply the update
    it(
      'applies contract changes and writes marker',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToContractV2(testSetup.testDir, configPath);

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);
          const applyOutput = stripAnsi(consoleOutput.join('\n'));

          expect(applyOutput).toContain('Applied');
          expect(applyOutput).toContain('Signature');

          // Verify slug column exists in database
          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'project'
                AND column_name = 'slug'
            `);
            expect(columnResult.rows.length).toBe(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 4: No-op update
    it(
      'applies zero operations when database already matches contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);
          const applyOutput = stripAnsi(consoleOutput.join('\n'));

          expect(applyOutput).toContain('Database already matches contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 5: Destructive changes with a safety review
    it(
      'shows destructive operations in plan mode for drifted schema',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Inject drift: extra column and extra table not in contract
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."account" ADD COLUMN "legacy_code" text');
            await client.query(
              'CREATE TABLE "public"."legacy_audit" (id int4 PRIMARY KEY, note text)',
            );
          });

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));

          expect(planOutput).toContain('legacy_code');
          expect(planOutput).toContain('destructive');
          expect(planOutput).toContain('legacy_audit');
          expect(planOutput).toContain('dry run');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 6: Planning conflicts
    it(
      'fails with planning conflict when live schema diverges from contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Swap primary key: drop FK first, then drop PK on id, add PK on email
          await withClient(connectionString, async (client) => {
            await client.query(
              'ALTER TABLE "public"."project" DROP CONSTRAINT IF EXISTS "project_accountId_fkey"',
            );
            await client.query(
              'ALTER TABLE "public"."account" DROP CONSTRAINT IF EXISTS "account_pkey"',
            );
            await client.query('ALTER TABLE "public"."account" ADD PRIMARY KEY ("email")');
          });

          const exitCode = await runDbUpdateAllowFailure(testSetup, [
            '--config',
            configPath,
            '--no-color',
          ]);

          expect(exitCode).not.toBe(0);
          const allOutput = [...consoleOutput, ...consoleErrors].join('\n');
          expect(allOutput).toMatch(/conflict|PLANNING_FAILED/i);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 7a: Destructive changes gate
    it(
      'fails with DESTRUCTIVE_CHANGES when destructive ops are not confirmed',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Add drift column so the planner generates a destructive drop
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."project" ADD COLUMN "legacy_notes" text');
          });

          const exitCode = await runDbUpdateAllowFailure(testSetup, [
            '--config',
            configPath,
            '--no-interactive',
            '--no-color',
          ]);

          expect(exitCode).not.toBe(0);
          const allOutput = [...consoleOutput, ...consoleErrors].join('\n');
          expect(allOutput).toMatch(/destructive/i);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 7b: Runner failure after planning (with -y)
    it(
      'fails during apply when a blocking view prevents column drop',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Add drift column + blocking view
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."project" ADD COLUMN "legacy_notes" text');
            await client.query(
              'CREATE VIEW "public"."legacy_notes_view" AS SELECT id, legacy_notes FROM "public"."project"',
            );
          });

          const exitCode = await runDbUpdateAllowFailure(testSetup, [
            '--config',
            configPath,
            '-y',
            '--no-color',
          ]);

          expect(exitCode).not.toBe(0);
          const allOutput = [...consoleOutput, ...consoleErrors].join('\n');
          // The runner attempts to drop legacy_notes but the view blocks it.
          // The post-apply schema verification detects the column still exists.
          expect(allOutput).toContain('legacy_notes');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 8: JSON output for tooling
    it(
      'returns JSON envelope in plan mode with rich contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToContractV2(testSetup.testDir, configPath);

          const outputStart = consoleOutput.length;
          await runDbUpdate(testSetup, [
            '--config',
            configPath,
            '--dry-run',
            '--json',
            '--no-color',
          ]);
          const output = consoleOutput.slice(outputStart).join('\n').trim();
          const payload = JSON.parse(output) as Record<string, unknown>;

          expect(payload).toMatchObject({
            ok: true,
            mode: 'plan',
            plan: {
              targetId: expect.any(String),
              destination: { storageHash: expect.any(String) },
              operations: expect.any(Array),
            },
            summary: expect.any(String),
            timings: {
              total: expect.any(Number),
            },
          });
          expect(payload).not.toHaveProperty('origin');

          const operations = (payload as { plan: { operations: unknown[] } }).plan.operations;
          expect(operations.length).toBeGreaterThan(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
