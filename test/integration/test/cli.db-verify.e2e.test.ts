import { copyFileSync, mkdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createDbVerifyCommand } from '@prisma-next/cli/commands/db-verify';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeCommand,
  getExitCode,
  loadContractFromDisk,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-verify tests
const fixtureSubdir = 'db-verify';

withTempDir(({ createTempDir }) => {
  describe('db verify command (e2e)', () => {
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

    it(
      'verifies database with matching marker via driver',
      async () => {
        await withDevDatabase(
          async ({ connectionString }) => {
            // Set up test directory from fixtures with db config
            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const testDir = testSetup.testDir;
            const configPath = testSetup.configPath;

            // Emit contract first
            const emitCommand = createContractEmitCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
            } finally {
              process.chdir(originalCwd);
            }

            // Load precomputed contract from disk
            const contractJsonPath = join(testDir, 'output', 'contract.json');
            const contract = loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

            await withClient(connectionString, async (client) => {
              // Setup marker schema and table
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);

              // Write marker matching contract
              const write = writeContractMarker({
                coreHash: contract.coreHash,
                profileHash: contract.profileHash ?? contract.coreHash,
                contractJson: contract,
                canonicalVersion: 1,
              });
              await executeStatement(client, write.insert);
              // withClient will close the client after this callback returns
            });

            // Clear console output before running the command we want to test
            // (previous commands like 'contract emit' may have added output)
            const outputStartIndex = consoleOutput.length;

            const command = createDbVerifyCommand();
            const verifyCwd = process.cwd();
            try {
              process.chdir(testDir);
              await executeCommand(command, ['--config', configPath, '--json']);
            } finally {
              process.chdir(verifyCwd);
            }

            // Check exit code is 0 (success)
            const exitCode = getExitCode();
            expect(exitCode).toBe(0);

            // Parse and verify JSON output (only from this command)
            // When --json is set, output should be clean JSON only
            const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
            const parsed = JSON.parse(output) as Record<string, unknown>;
            expect(parsed).toMatchObject({
              ok: true,
              summary: expect.any(String),
              contract: {
                coreHash: expect.any(String),
              },
              marker: {
                coreHash: expect.any(String),
              },
              target: {
                expected: expect.any(String),
              },
            });

            // Verify coreHash matches
            expect((parsed['contract'] as { coreHash: string }).coreHash).toBe(contract.coreHash);
            expect((parsed['marker'] as { coreHash: string }).coreHash).toBe(contract.coreHash);
            expect(consoleErrors.length).toBe(0);
          },
          // Use random ports to avoid conflicts in CI (no options = random ports)
          {},
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports error when marker is missing via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const emitCwd1 = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(emitCwd1);
          }

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);
            // withClient will close the client after this callback returns
          });

          // Load precomputed contract from disk
          const contractJsonPath = join(testDir, 'output', 'contract.json');
          loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

          const command = createDbVerifyCommand();
          const verifyCwd1 = process.cwd();
          try {
            process.chdir(testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--json']),
            ).rejects.toThrow('process.exit called');
          } finally {
            process.chdir(verifyCwd1);
          }

          // Check exit code is non-zero (error)
          const exitCode = getExitCode();
          expect(exitCode).not.toBe(0);

          const errorOutput = consoleErrors.join('\n');
          expect(() => JSON.parse(errorOutput)).not.toThrow();

          const parsed = JSON.parse(errorOutput);
          expect(parsed).toMatchObject({
            code: 'PN-RTM-3001',
            summary: expect.any(String),
            why: expect.any(String),
            fix: expect.any(String),
          });
          expect(parsed.summary).toContain('Marker missing');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON when --json flag is provided via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Load precomputed contract from disk
          const contractJsonPath = join(testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);
            // withClient will close the client after this callback returns
          });

          // Clear console output before running the command we want to test
          // (previous commands like 'contract emit' may have added output)
          const outputStartIndex = consoleOutput.length;

          const command = createDbVerifyCommand();
          const verifyCwd2 = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(command, ['--config', configPath, '--json']);
          } finally {
            process.chdir(verifyCwd2);
          }

          // Check exit code is 0 (success)
          const exitCode = getExitCode();
          expect(exitCode).toBe(0);

          // Parse and verify JSON output (only from this command)
          // When --json is used, only JSON should be output
          const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
          const parsed = JSON.parse(output) as Record<string, unknown>;
          expect(parsed).toMatchObject({
            ok: true,
            summary: expect.any(String),
            contract: {
              coreHash: expect.any(String),
            },
            marker: {
              coreHash: expect.any(String),
            },
            target: {
              expected: expect.any(String),
            },
            meta: {
              contractPath: expect.any(String),
            },
            timings: {
              total: expect.any(Number),
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports error with JSON when marker is missing and --json flag is provided via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const emitCwd2 = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(emitCwd2);
          }

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);
            // withClient will close the client after this callback returns
          });

          // Load precomputed contract from disk
          const contractJsonPath = join(testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);
          expect(contract).toBeDefined();
          expect(contract.coreHash).toBeDefined();

          const command = createDbVerifyCommand();
          const verifyCwd4 = process.cwd();
          try {
            process.chdir(testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--json']),
            ).rejects.toThrow('process.exit called');
          } finally {
            process.chdir(verifyCwd4);
          }

          // Check exit code is non-zero (error)
          const exitCode = getExitCode();
          expect(exitCode).not.toBe(0);

          const errorOutput = consoleErrors.join('\n');
          expect(() => JSON.parse(errorOutput)).not.toThrow();

          const parsed = JSON.parse(errorOutput);
          expect(parsed).toMatchObject({
            code: 'PN-RTM-3001',
            summary: expect.any(String),
            why: expect.any(String),
            fix: expect.any(String),
          });
          expect(parsed.summary).toContain('Marker missing');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports PN-CLI-4010 when driver is missing',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up test directory from fixtures with config that has db.url but no driver
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.no-query-runner.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;

          // Emit contract first using the with-db config
          const emitTestSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const emitConfigPath = emitTestSetup.configPath;

          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(emitTestSetup.testDir);
            await executeCommand(emitCommand, ['--config', emitConfigPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const contractJsonPath = join(emitTestSetup.testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

          // Copy contract file to the test directory so the command can read it
          const testContractJsonPath = join(testDir, 'output', 'contract.json');
          const testContractDtsPath = join(testDir, 'output', 'contract.d.ts');
          mkdirSync(join(testDir, 'output'), { recursive: true });
          copyFileSync(contractJsonPath, testContractJsonPath);
          const emitContractDtsPath = join(emitTestSetup.testDir, 'output', 'contract.d.ts');
          try {
            await access(emitContractDtsPath);
            copyFileSync(emitContractDtsPath, testContractDtsPath);
          } catch {
            // contract.d.ts doesn't exist, skip copying
          }

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);
            // withClient will close the client after this callback returns
          });

          // Now test verify with the no-driver config
          // Mock loadConfig to return config without driver (bypassing validation)
          const originalLoadConfig = await import('@prisma-next/cli/config-loader');
          vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
            family: {
              familyId: 'sql',
              create: vi.fn(),
            },
            target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
            adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
            // driver is missing - this is what we're testing
            extensionPacks: [],
            contract: {
              source: contract,
              output: 'output/contract.json',
              types: 'output/contract.d.ts',
            },
            db: {
              url: connectionString,
            },
          } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

          const command = createDbVerifyCommand();
          const verifyCwd3 = process.cwd();
          try {
            process.chdir(testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--json']),
            ).rejects.toThrow('process.exit called');
          } finally {
            process.chdir(verifyCwd3);
          }

          // Check exit code is non-zero (error)
          const exitCode = getExitCode();
          expect(exitCode).not.toBe(0);

          const errorOutput = consoleErrors.join('\n');
          expect(() => JSON.parse(errorOutput)).not.toThrow();

          const parsed = JSON.parse(errorOutput);
          expect(parsed).toMatchObject({
            code: 'PN-CLI-4010',
            summary: expect.any(String),
            why: expect.any(String),
            fix: expect.any(String),
          });
          expect(parsed.summary).toContain('Driver is required');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
