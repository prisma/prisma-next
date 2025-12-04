import { join } from 'node:path';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbVerifyCommand } from '../src/commands/db-verify';
import {
  executeCommand,
  getExitCode,
  loadContractFromDisk,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/test-helpers';

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

            {
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

              const command = createDbVerifyCommand();
              const originalCwd = process.cwd();
              try {
                process.chdir(testDir);
                await executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']);
              } finally {
                process.chdir(originalCwd);
              }

              // Check exit code is 0 (success)
              const exitCode = getExitCode();
              expect(exitCode).toBe(0);

              // Parse and verify JSON output
              const jsonOutput = consoleOutput.join('\n');
              expect(() => JSON.parse(jsonOutput)).not.toThrow();

              const parsed = JSON.parse(jsonOutput);
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
              expect(parsed.contract.coreHash).toBe(contract.coreHash);
              expect(parsed.marker.coreHash).toBe(contract.coreHash);
              expect(consoleErrors.length).toBe(0);
            }
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

          {
            await withClient(connectionString, async (client) => {
              // Setup marker schema and table but don't write marker
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);
              // withClient will close the client after this callback returns
            });

            // Load precomputed contract from disk (contract.json is copied by setupTestDirectoryFromFixtures)
            const contractJsonPath = join(testDir, 'output', 'contract.json');
            loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
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
          }
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

          {
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

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']);
            } finally {
              process.chdir(originalCwd);
            }

            // Check exit code is 0 (success)
            const exitCode = getExitCode();
            expect(exitCode).toBe(0);

            const jsonOutput = consoleOutput.join('\n');
            expect(jsonOutput).not.toBe('');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
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
          }
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

          {
            await withClient(connectionString, async (client) => {
              // Setup marker schema and table but don't write marker
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);
              // withClient will close the client after this callback returns
            });

            // Load precomputed contract from disk (contract.json is copied by setupTestDirectoryFromFixtures)
            const contractJsonPath = join(testDir, 'output', 'contract.json');
            loadContractFromDisk<SqlContract<SqlStorage>>(contractJsonPath);

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
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
          }
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

          {
            // Load precomputed contract from disk
            // Use the with-db config setup to get the contract files
            const emitTestSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const contractJsonPath = join(emitTestSetup.testDir, 'output', 'contract.json');
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

            // Now test verify with the no-driver config
            // Mock loadConfig to return config without driver (bypassing validation)
            const originalLoadConfig = await import('../src/config-loader');
            vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
              family: {
                familyId: 'sql',
                create: vi.fn(),
              },
              target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
              adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
              // driver is missing - this is what we're testing
              extensions: [],
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
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, [
                  '--config',
                  'prisma-next.config.no-query-runner.ts',
                  '--json',
                ]),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
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
            expect(parsed.summary).toContain('Driver is required for DB-connected commands');
            expect(parsed.fix).toContain('Add driver to prisma-next.config.ts');
          }
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
