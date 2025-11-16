import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { emitContract } from '@prisma-next/core-control-plane/emit-contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbSchemaVerifyCommand } from '../src/commands/db-schema-verify';
import { loadConfig } from '../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../src/pack-assembly';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for db-schema-verify tests
const fixtureSubdir = 'db-schema-verify';

/**
 * Emits the contract to disk using the config file.
 * Returns the validated contract for use in tests.
 */
async function emitContractFromConfig(
  configPath: string,
  testDir: string,
): Promise<SqlContract<SqlStorage>> {
  const config = await loadConfig(configPath);
  if (!config.contract) {
    throw new Error('Config.contract is required');
  }

  const contractConfig = config.contract;
  let contractRaw: unknown;
  if (typeof contractConfig.source === 'function') {
    contractRaw = await contractConfig.source();
  } else {
    contractRaw = contractConfig.source;
  }

  const contractWithoutMappings = config.family.stripMappings
    ? config.family.stripMappings(contractRaw)
    : contractRaw;

  const contractIR = config.family.validateContractIR(contractWithoutMappings);

  const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
  const operationRegistry = assembleOperationRegistry(descriptors, config.family);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(config.adapter, config.target, config.extensions ?? []);

  const emitResult = await emitContract({
    contractIR: contractIR as ContractIR,
    targetFamily: config.family.hook,
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,
  });

  // Write contract files
  const contractJsonPath = resolve(testDir, contractConfig.output ?? 'src/prisma/contract.json');
  const contractDtsPath = resolve(testDir, contractConfig.types ?? 'src/prisma/contract.d.ts');
  mkdirSync(dirname(contractJsonPath), { recursive: true });
  mkdirSync(dirname(contractDtsPath), { recursive: true });
  writeFileSync(contractJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(contractDtsPath, emitResult.contractDts, 'utf-8');

  const contractJson = JSON.parse(emitResult.contractJson) as Record<string, unknown>;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

describe('db schema-verify command (e2e)', () => {
  let consoleErrors: string[] = [];
  let consoleOutput: string[] = [];
  let cleanupMocks: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleErrors = mocks.consoleErrors;
    consoleOutput = mocks.consoleOutput;
    cleanupMocks = mocks.cleanup;
  });

  afterEach(() => {
    cleanupMocks();
  });

  it(
    'reports PN-CLI-4008 when verifySchema hook is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

            // Mock config to remove verifySchema hook
            const configLoaderModule = await import('../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementation(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: undefined,
                  }
                : undefined;
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }

            // Check exit code is non-zero (error)
            const exitCode = getExitCode();
            expect(exitCode).not.toBe(0);

            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();

            const parsed = JSON.parse(errorOutput);
            expect(parsed).toMatchObject({
              code: 'PN-CLI-4008',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('Family verifySchema() is required');
            expect(parsed.fix).toContain(
              'Ensure family.verify.verifySchema() is exported by your family package',
            );
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54240, databasePort: 54241, shadowDatabasePort: 54242 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it('reports PN-CLI-4005 when DB URL is missing', async () => {
    // Set up test directory from fixtures without db.url
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-db-url.ts',
    );
    const testDir = testSetup.testDir;
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      // Emit contract using the config
      await emitContractFromConfig(configPath, testDir);

      const command = createDbSchemaVerifyCommand();
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
        code: 'PN-CLI-4005',
        summary: expect.any(String),
        why: expect.any(String),
        fix: expect.any(String),
      });
      expect(parsed.summary).toContain('Database URL is required');
    } finally {
      cleanupDir();
    }
  });

  it(
    'reports PN-CLI-4010 when driver is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with config that has db.url but no driver
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.no-driver.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

            const command = createDbSchemaVerifyCommand();
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
              code: 'PN-CLI-4010',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('Driver is required');
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54243, databasePort: 54244, shadowDatabasePort: 54245 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4004 when contract file is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const cleanupDir = testSetup.cleanup;

          try {
            // Don't emit contract - test missing file
            const command = createDbSchemaVerifyCommand();
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
              code: 'PN-CLI-4004',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('File not found');
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54246, databasePort: 54247, shadowDatabasePort: 54248 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'outputs JSON when --json flag is provided',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema to return a failure so we can test JSON error output format
            const configLoaderModule = await import('../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementation(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: vi.fn().mockResolvedValue({
                      ok: false,
                      code: 'PN-SCHEMA-0001',
                      summary: 'Database schema does not match contract',
                      contract: { coreHash: 'sha256:test' },
                      target: { expected: 'postgres' },
                      schema: {
                        issues: [
                          {
                            kind: 'missing_table',
                            table: 'test',
                            message: 'Table test is missing',
                          },
                        ],
                      },
                      timings: { total: 10 },
                    }),
                  }
                : undefined;
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }

            // Check exit code is non-zero (error)
            const exitCode = getExitCode();
            expect(exitCode).not.toBe(0);

            // Verify output is JSON (schema verification failures output to stdout, not stderr)
            const output = consoleOutput.join('\n');
            expect(output).not.toBe('');
            expect(() => JSON.parse(output)).not.toThrow();

            const parsed = JSON.parse(output);
            expect(parsed).toMatchObject({
              ok: false,
              code: expect.any(String),
              summary: expect.any(String),
              schema: expect.any(Object),
            });
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54249, databasePort: 54250, shadowDatabasePort: 54251 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'propagates --strict flag',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema to verify --strict flag is passed through
            const configLoaderModule = await import('../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const verifySchemaMock = vi.fn().mockResolvedValue({
              ok: false,
              code: 'PN-SCHEMA-0001',
              summary: 'Database schema does not match contract',
              contract: { coreHash: 'sha256:test' },
              target: { expected: 'postgres' },
              schema: { issues: [] },
              timings: { total: 10 },
            });
            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementation(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: verifySchemaMock,
                  }
                : undefined;
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                executeCommand(command, [
                  '--config',
                  'prisma-next.config.ts',
                  '--strict',
                  '--json',
                ]),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }

            // Verify --strict flag was passed to verifySchema
            expect(verifySchemaMock).toHaveBeenCalledOnce();
            const callArgs = verifySchemaMock.mock.calls[0]?.[0];
            expect(callArgs?.strict).toBe(true);

            // Check exit code is non-zero (error)
            const exitCode = getExitCode();
            expect(exitCode).not.toBe(0);

            // Verify error output is JSON
            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54252, databasePort: 54253, shadowDatabasePort: 54254 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'verifies database schema matches contract via IR',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contract = await emitContractFromConfig(configPath, testDir);

            // Setup database schema matching the contract
            await withClient(connectionString, async (client) => {
              // Create the user table matching the contract
              await client.query(`
                CREATE TABLE "user" (
                  "id" INTEGER NOT NULL,
                  "email" TEXT NOT NULL,
                  PRIMARY KEY ("id")
                )
              `);
            });

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              try {
                await executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']);
              } catch (error) {
                // If command fails, check error output for debugging
                const errorOutput = consoleErrors.join('\n');
                if (errorOutput) {
                  console.error('Command failed with errors:', errorOutput);
                }
                throw error;
              }
            } finally {
              process.chdir(originalCwd);
            }

            // Check exit code is 0 (success)
            const exitCode = getExitCode();
            if (exitCode !== 0) {
              const errorOutput = consoleErrors.join('\n');
              const output = consoleOutput.join('\n');
              console.error('Unexpected exit code:', exitCode);
              if (errorOutput) {
                console.error('Error output:', errorOutput);
              }
              if (output) {
                console.error('Standard output:', output);
              }
            }
            expect(exitCode).toBe(0);

            // Parse and verify JSON output
            const jsonOutput = consoleOutput.join('\n');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
            expect(parsed).toMatchObject({
              ok: true,
              summary: 'Database schema matches contract',
              contract: {
                coreHash: expect.any(String),
              },
              target: {
                expected: 'postgres',
              },
              schema: {
                issues: [],
              },
              timings: {
                total: expect.any(Number),
              },
            });

            // Verify coreHash matches
            expect(parsed.contract.coreHash).toBe(contract.coreHash);
            expect(consoleErrors.length).toBe(0);
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54255, databasePort: 54256, shadowDatabasePort: 54257 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports schema issues when database schema does not match contract',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contract = await emitContractFromConfig(configPath, testDir);

            // Setup database schema that doesn't match the contract
            await withClient(connectionString, async (client) => {
              // Create a table with wrong column types and missing primary key
              await client.query(`
                CREATE TABLE "user" (
                  "id" TEXT NOT NULL,
                  "email" INTEGER NOT NULL
                )
              `);
            });

            const command = createDbSchemaVerifyCommand();
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

            // Parse and verify JSON output
            const jsonOutput = consoleOutput.join('\n');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
            expect(parsed).toMatchObject({
              ok: false,
              code: 'PN-SCHEMA-0001',
              summary: expect.stringContaining('issue'),
              contract: {
                coreHash: expect.any(String),
              },
              target: {
                expected: 'postgres',
              },
              schema: {
                issues: expect.arrayContaining([
                  expect.objectContaining({
                    kind: expect.any(String),
                    table: 'user',
                    message: expect.any(String),
                  }),
                ]),
              },
              timings: {
                total: expect.any(Number),
              },
            });

            // Verify we have issues for type mismatches and missing primary key
            const issues = parsed.schema.issues as Array<{ kind: string; table: string; column?: string; message: string }>;
            const typeMismatchIssues = issues.filter((issue) => issue.kind === 'type_mismatch');
            const primaryKeyIssues = issues.filter((issue) => issue.kind === 'primary_key_mismatch');

            expect(typeMismatchIssues.length).toBeGreaterThan(0);
            expect(primaryKeyIssues.length).toBeGreaterThan(0);

            // Verify coreHash matches
            expect(parsed.contract.coreHash).toBe(contract.coreHash);
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54258, databasePort: 54259, shadowDatabasePort: 54260 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports missing table when table does not exist in database',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with db config
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contract = await emitContractFromConfig(configPath, testDir);

            // Don't create any tables - database is empty

            const command = createDbSchemaVerifyCommand();
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

            // Parse and verify JSON output
            const jsonOutput = consoleOutput.join('\n');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
            expect(parsed).toMatchObject({
              ok: false,
              code: 'PN-SCHEMA-0001',
              summary: expect.stringContaining('issue'),
              contract: {
                coreHash: expect.any(String),
              },
              target: {
                expected: 'postgres',
              },
              schema: {
                issues: expect.arrayContaining([
                  expect.objectContaining({
                    kind: 'missing_table',
                    table: 'user',
                    message: expect.stringContaining('not present in database'),
                  }),
                ]),
              },
              timings: {
                total: expect.any(Number),
              },
            });

            // Verify coreHash matches
            expect(parsed.contract.coreHash).toBe(contract.coreHash);
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54261, databasePort: 54262, shadowDatabasePort: 54263 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
