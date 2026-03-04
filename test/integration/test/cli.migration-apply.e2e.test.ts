import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import type { MigrationApplyResult } from '@prisma-next/cli/commands/migration-apply';
import { createMigrationApplyCommand } from '@prisma-next/cli/commands/migration-apply';
import { createMigrationPlanCommand } from '@prisma-next/cli/commands/migration-plan';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const fixtureSubdir = 'migration-apply';
const workspaceRoot = resolve(__dirname, '../../..');

async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  try {
    process.chdir(dir);
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

async function emitContract(testDir: string, configPath: string): Promise<void> {
  const command = createContractEmitCommand();
  await inDir(testDir, () => executeCommand(command, ['--config', configPath, '--no-color']));
}

async function runMigrationPlan(testDir: string, args: readonly string[]): Promise<number> {
  const command = createMigrationPlanCommand();
  return inDir(testDir, () => executeCommand(command, [...args]));
}

async function runMigrationApply(testDir: string, args: readonly string[]): Promise<number> {
  const command = createMigrationApplyCommand();
  return inDir(testDir, () => executeCommand(command, [...args]));
}

withTempDir(({ createTempDir }) => {
  describe('migration apply command (e2e)', () => {
    let consoleOutput: string[];
    let consoleErrors: string[];
    let cleanupMocks: () => void;

    beforeEach(() => {
      process.chdir(workspaceRoot);
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      consoleErrors = mocks.consoleErrors;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      process.chdir(workspaceRoot);
      cleanupMocks();
    });

    describe('plan then apply (happy path)', () => {
      it(
        'applies a single migration to an empty database',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath: baseConfigPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const configPath = baseConfigPath;

            await emitContract(testDir, configPath);

            consoleOutput.length = 0;
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);

            consoleOutput.length = 0;
            consoleErrors.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const output = consoleOutput.join('\n').trim();
            const parsed = JSON.parse(output) as MigrationApplyResult;

            expect(parsed.ok).toBe(true);
            expect(parsed.migrationsApplied).toBe(1);
            expect(parsed.applied).toHaveLength(1);
            expect(parsed.applied[0]!.operationsExecuted).toBeGreaterThan(0);

            // Verify table was created
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user'
              `);
              expect(result.rows.length).toBe(1);
            });

            // Verify marker was written
            await withClient(connectionString, async (client) => {
              const result = await client.query(
                'SELECT core_hash FROM prisma_contract.marker WHERE id = $1',
                [1],
              );
              expect(result.rows.length).toBe(1);
              expect(result.rows[0]?.core_hash).toBe(parsed.markerHash);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('idempotency', () => {
      it(
        're-run after success is a no-op',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);

            // First apply
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--no-color']);

            // Second apply — should be no-op
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const output = consoleOutput.join('\n').trim();
            const parsed = JSON.parse(output) as MigrationApplyResult;

            expect(parsed.ok).toBe(true);
            expect(parsed.migrationsApplied).toBe(0);
            expect(parsed.summary).toBe('Already up to date');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('destination contract targeting', () => {
      it(
        'fails when current contract has no planned migration path',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath, contractPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            // Change contract and re-emit without planning a new migration.
            const contractSrc = readFileSync(contractPath!, 'utf-8');
            const modified = contractSrc.replace(
              `.primaryKey(['id'])`,
              `.column('nickname', { type: textColumn, nullable: true })\n      .primaryKey(['id'])`,
            );
            writeFileSync(contractPath!, modified, 'utf-8');
            await emitContract(testDir, configPath);

            consoleOutput.length = 0;
            consoleErrors.length = 0;
            let failed = false;
            try {
              await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);
            } catch {
              failed = true;
            }

            expect(failed).toBe(true);
            expect(getExitCode()).toBe(1);
            const stderr = stripAnsi(consoleErrors.join('\n'));
            expect(stderr).toContain('Current contract has no planned migration path');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('multiple migrations', () => {
      it(
        'applies multiple migrations in DAG order',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath, contractPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            // First migration: create user table
            await emitContract(testDir, configPath);
            consoleOutput.length = 0;
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'add_user',
              '--no-color',
            ]);

            // Modify contract: add a column
            const contractSrc = readFileSync(contractPath!, 'utf-8');
            const modified = contractSrc.replace(
              `.primaryKey(['id'])`,
              `.column('name', { type: textColumn, nullable: true })\n      .primaryKey(['id'])`,
            );
            writeFileSync(contractPath!, modified, 'utf-8');

            // Second migration: add name column
            consoleOutput.length = 0;
            await emitContract(testDir, configPath);
            consoleOutput.length = 0;
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'add_name',
              '--no-color',
            ]);

            // Apply all migrations at once
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const output = consoleOutput.join('\n').trim();
            const parsed = JSON.parse(output) as MigrationApplyResult;

            expect(parsed.ok).toBe(true);
            expect(parsed.migrationsApplied).toBe(2);
            expect(parsed.applied).toHaveLength(2);

            // Verify both table and column exist
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'user'
                ORDER BY ordinal_position
              `);
              const columns = result.rows.map((r: Record<string, unknown>) => r['column_name']);
              expect(columns).toContain('id');
              expect(columns).toContain('email');
              expect(columns).toContain('name');
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('resume after partial apply', () => {
      it(
        'resumes from last successful migration after failure',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath, contractPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            // Create two migrations
            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);

            // Apply first migration successfully.
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);
            const firstApply = JSON.parse(consoleOutput.join('\n').trim()) as MigrationApplyResult;
            expect(firstApply.migrationsApplied).toBe(1);

            // Insert data so a later NOT NULL column addition will fail.
            await withClient(connectionString, async (client) => {
              await client.query(`INSERT INTO "user" (id, email) VALUES (1, 'user@example.com')`);
            });

            // Plan second migration that adds a non-null column with no default.
            const contractSrc = readFileSync(contractPath!, 'utf-8');
            const modified = contractSrc.replace(
              `.primaryKey(['id'])`,
              `.column('required_name', { type: textColumn, nullable: false })\n      .primaryKey(['id'])`,
            );
            writeFileSync(contractPath!, modified, 'utf-8');

            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'add_required_name',
              '--no-color',
            ]);

            // Apply should fail on the second migration because existing rows violate NOT NULL.
            consoleOutput.length = 0;
            let failed = false;
            try {
              await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);
            } catch {
              failed = true;
            }
            expect(failed).toBe(true);
            expect(getExitCode()).toBe(1);

            // Marker must remain at the first migration hash (resume point).
            const migrationsDir = join(testDir, 'migrations');
            const packages = await readMigrationsDir(migrationsDir);
            const firstMigration = packages.find((p) => p.manifest.from === 'sha256:empty');
            const secondMigration = packages.find(
              (p) => p.manifest.to !== firstMigration?.manifest.to,
            );
            expect(firstMigration).toBeDefined();
            expect(secondMigration).toBeDefined();

            await withClient(connectionString, async (client) => {
              const marker = await client.query(
                'SELECT core_hash FROM prisma_contract.marker WHERE id = $1',
                [1],
              );
              expect(marker.rows[0]?.core_hash).toBe(firstMigration!.manifest.to);
            });

            // Make second migration runnable, then re-run apply; it should resume from marker.
            await withClient(connectionString, async (client) => {
              await client.query('DELETE FROM "user"');
            });

            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);
            const resumeResult = JSON.parse(
              consoleOutput.join('\n').trim(),
            ) as MigrationApplyResult;
            expect(resumeResult.migrationsApplied).toBe(1);
            expect(resumeResult.markerHash).toBe(secondMigration!.manifest.to);
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('styled output', () => {
      it(
        'produces human-readable output on apply',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);

            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--no-color']);

            const output = stripAnsi(consoleOutput.join('\n'));
            expect(output).toContain('Applied');
            expect(output).toContain('migration(s)');
            expect(output).toContain('marker:');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('destructive changes', () => {
      it(
        'applies a migration that drops a column',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath, contractPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            // Plan and apply the initial migration (creates user table with id + email)
            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const firstApply = JSON.parse(consoleOutput.join('\n').trim()) as MigrationApplyResult;
            expect(firstApply.ok).toBe(true);
            expect(firstApply.migrationsApplied).toBe(1);

            // Verify email column exists
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'email'
              `);
              expect(result.rows.length).toBe(1);
            });

            // Remove the email column from the contract
            const contractSrc = readFileSync(contractPath!, 'utf-8');
            const modified = contractSrc
              .replace(/\.column\('email'[^)]*\)\s*\n/, '')
              .replace(/\.field\('email'[^)]*\)/, '');
            writeFileSync(contractPath!, modified, 'utf-8');

            // Re-emit and plan the destructive migration
            await emitContract(testDir, configPath);
            consoleOutput.length = 0;
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'drop_email',
              '--no-color',
            ]);

            // Apply the destructive migration
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const secondApply = JSON.parse(consoleOutput.join('\n').trim()) as MigrationApplyResult;
            expect(secondApply.ok).toBe(true);
            expect(secondApply.migrationsApplied).toBe(1);

            // Verify email column no longer exists
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'email'
              `);
              expect(result.rows.length).toBe(0);
            });

            // Verify marker was updated
            await withClient(connectionString, async (client) => {
              const result = await client.query(
                'SELECT core_hash FROM prisma_contract.marker WHERE id = $1',
                [1],
              );
              expect(result.rows.length).toBe(1);
              expect(result.rows[0]?.core_hash).toBe(secondApply.markerHash);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'applies multiple migrations including destructive in DAG order',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testDir, configPath, contractPath } = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            // Plan initial migration
            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'initial',
              '--no-color',
            ]);

            // Add a column, then remove email — two sequential changes
            const contractSrc = readFileSync(contractPath!, 'utf-8');
            const withName = contractSrc.replace(
              `.primaryKey(['id'])`,
              `.column('name', { type: textColumn, nullable: true })\n      .primaryKey(['id'])`,
            );
            writeFileSync(contractPath!, withName, 'utf-8');
            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'add_name',
              '--no-color',
            ]);

            const withNameSrc = readFileSync(contractPath!, 'utf-8');
            const withoutEmail = withNameSrc
              .replace(/\.column\('email'[^)]*\)\s*\n/, '')
              .replace(/\.field\('email'[^)]*\)/, '');
            writeFileSync(contractPath!, withoutEmail, 'utf-8');
            await emitContract(testDir, configPath);
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'drop_email',
              '--no-color',
            ]);

            // Apply all three migrations at once against fresh DB
            consoleOutput.length = 0;
            await runMigrationApply(testDir, ['--config', configPath, '--json', '--no-color']);

            const result = JSON.parse(consoleOutput.join('\n').trim()) as MigrationApplyResult;
            expect(result.ok).toBe(true);
            expect(result.migrationsApplied).toBe(3);

            // Verify final state: user table has id + name, no email
            await withClient(connectionString, async (client) => {
              const cols = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'user'
                ORDER BY ordinal_position
              `);
              const columnNames = cols.rows.map((r: Record<string, unknown>) => r['column_name']);
              expect(columnNames).toContain('id');
              expect(columnNames).toContain('name');
              expect(columnNames).not.toContain('email');
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
