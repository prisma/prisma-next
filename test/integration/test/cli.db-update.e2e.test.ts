import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, setupCommandMocks, withTempDir } from './utils/cli-test-helpers';
import { runDbInit } from './utils/db-init-test-helpers';
import { runDbUpdate, setupDbUpdateFixture } from './utils/db-update-test-helpers';

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
          await runDbUpdate(testSetup, ['--config', configPath, '--plan', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned 0 operation(s)');

          consoleOutput.length = 0;
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);
          const applyOutput = stripAnsi(consoleOutput.join('\n'));
          expect(applyOutput).toContain('Applied 0 operation(s)');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'plans and applies contract changes from marker-managed state',
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
          await runDbUpdate(testSetup, ['--config', configPath, '--plan', '--no-color']);
          const planOutput = stripAnsi(consoleOutput.join('\n'));
          expect(planOutput).toContain('Planned');
          expect(planOutput).toContain('nickname');

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
          await runDbUpdate(testSetup, ['--config', configPath, '--plan', '--json', '--no-color']);
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
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
