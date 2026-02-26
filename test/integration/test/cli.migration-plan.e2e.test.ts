import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import type { MigrationPlanResult } from '@prisma-next/cli/commands/migration-plan';
import { createMigrationPlanCommand } from '@prisma-next/cli/commands/migration-plan';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { verifyMigration } from '@prisma-next/migration-tools/attestation';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const fixtureSubdir = 'migration-plan';

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

withTempDir(({ createTempDir }) => {
  describe('migration plan command (e2e)', () => {
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

    describe('fresh project (no existing migrations)', () => {
      it(
        'creates a migration package with operations',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );
          const migrationsDir = join(testDir, 'migrations');

          await emitContract(testDir, configPath);

          consoleOutput.length = 0;
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--no-color',
          ]);

          const packages = await readMigrationsDir(migrationsDir);
          expect(packages).toHaveLength(1);

          const pkg = packages[0]!;
          expect(pkg.manifest.from).toBe(EMPTY_CONTRACT_HASH);
          expect(pkg.manifest.to).not.toBe(EMPTY_CONTRACT_HASH);
          expect(pkg.manifest.edgeId).not.toBeNull();
          expect(pkg.ops.length).toBeGreaterThan(0);

          const tableOp = pkg.ops.find((op) => op.id.includes('user'));
          expect(tableOp).toBeDefined();
        },
        timeouts.typeScriptCompilation,
      );

      it(
        'produces attested migration that passes verify',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );
          const migrationsDir = join(testDir, 'migrations');

          await emitContract(testDir, configPath);
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--no-color',
          ]);

          const packages = await readMigrationsDir(migrationsDir);
          const pkgDir = join(migrationsDir, packages[0]!.dirName);
          const verifyResult = await verifyMigration(pkgDir);
          expect(verifyResult.ok).toBe(true);
        },
        timeouts.typeScriptCompilation,
      );

      it(
        'outputs JSON envelope with --json',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );

          await emitContract(testDir, configPath);

          consoleOutput.length = 0;
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--json',
            '--no-color',
          ]);

          const output = consoleOutput.join('\n').trim();
          const parsed = JSON.parse(output) as MigrationPlanResult;

          expect(parsed.ok).toBe(true);
          expect(parsed.noOp).toBe(false);
          expect(parsed.from).toBe(EMPTY_CONTRACT_HASH);
          expect(parsed.to).toBeDefined();
          expect(parsed.edgeId).toBeDefined();
          expect(parsed.operations.length).toBeGreaterThan(0);
          expect(parsed.dir).toBeDefined();
        },
        timeouts.typeScriptCompilation,
      );
    });

    describe('no-op (unchanged contract)', () => {
      it(
        'reports no-op on second plan with same contract',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
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
          await runMigrationPlan(testDir, ['--config', configPath, '--json', '--no-color']);

          const output = consoleOutput.join('\n').trim();
          const parsed = JSON.parse(output) as MigrationPlanResult;

          expect(parsed.ok).toBe(true);
          expect(parsed.noOp).toBe(true);
          expect(parsed.operations).toHaveLength(0);
        },
        timeouts.typeScriptCompilation,
      );
    });

    describe('incremental changes', () => {
      it(
        'detects added column in second migration',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );
          const migrationsDir = join(testDir, 'migrations');

          await emitContract(testDir, configPath);
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--no-color',
          ]);

          const contractPath = join(testDir, 'contract.ts');
          const contractSrc = readFileSync(contractPath, 'utf-8');
          const modified = contractSrc.replace(
            `.primaryKey(['id'])`,
            `.column('name', { type: textColumn, nullable: true })\n      .primaryKey(['id'])`,
          );
          writeFileSync(contractPath, modified, 'utf-8');

          consoleOutput.length = 0;
          await emitContract(testDir, configPath);

          consoleOutput.length = 0;
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'add_name',
            '--json',
            '--no-color',
          ]);

          const output = consoleOutput.join('\n').trim();
          const parsed = JSON.parse(output) as MigrationPlanResult;

          expect(parsed.ok).toBe(true);
          expect(parsed.noOp).toBe(false);
          expect(parsed.operations.length).toBeGreaterThan(0);

          const addColOp = parsed.operations.find(
            (op) => op.id.includes('name') || op.label.includes('name'),
          );
          expect(addColOp).toBeDefined();

          const packages = await readMigrationsDir(migrationsDir);
          expect(packages).toHaveLength(2);

          const first = packages.find((p) => p.manifest.from === EMPTY_CONTRACT_HASH)!;
          const second = packages.find((p) => p.manifest.from !== EMPTY_CONTRACT_HASH)!;
          expect(first.manifest.to).toBe(second.manifest.from);
        },
        timeouts.typeScriptCompilation,
      );
    });

    describe('plan → verify → plan lifecycle', () => {
      it(
        'plan then verify then plan again yields no-op',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );
          const migrationsDir = join(testDir, 'migrations');

          await emitContract(testDir, configPath);

          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--no-color',
          ]);

          const packages = await readMigrationsDir(migrationsDir);
          const pkgDir = join(migrationsDir, packages[0]!.dirName);
          const verifyResult = await verifyMigration(pkgDir);
          expect(verifyResult.ok).toBe(true);

          consoleOutput.length = 0;
          await runMigrationPlan(testDir, ['--config', configPath, '--json', '--no-color']);

          const output = consoleOutput.join('\n').trim();
          const parsed = JSON.parse(output) as MigrationPlanResult;
          expect(parsed.noOp).toBe(true);
        },
        timeouts.typeScriptCompilation,
      );
    });

    describe('destructive changes', () => {
      it(
        'fails when a column is removed',
        async () => {
          const { testDir, configPath } = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
          );

          await emitContract(testDir, configPath);
          await runMigrationPlan(testDir, [
            '--config',
            configPath,
            '--name',
            'initial',
            '--no-color',
          ]);

          const contractPath = join(testDir, 'contract.ts');
          const contractSrc = readFileSync(contractPath, 'utf-8');
          const modified = contractSrc
            .replace(/\.column\('email'[^)]*\)\s*\n/, '')
            .replace(/\.field\('email'[^)]*\)/, '');
          writeFileSync(contractPath, modified, 'utf-8');

          consoleOutput.length = 0;
          consoleErrors.length = 0;
          await emitContract(testDir, configPath);

          consoleOutput.length = 0;
          consoleErrors.length = 0;

          let threw = false;
          try {
            await runMigrationPlan(testDir, [
              '--config',
              configPath,
              '--name',
              'remove_email',
              '--no-color',
            ]);
          } catch {
            threw = true;
          }

          expect(threw).toBe(true);
          const errorOutput = consoleErrors.join('\n');
          expect(errorOutput).toContain('destructive changes');
        },
        timeouts.typeScriptCompilation,
      );
    });
  });
});
