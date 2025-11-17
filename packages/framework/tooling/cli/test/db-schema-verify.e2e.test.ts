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
              const mockedFamily = {
                ...config.family,
                verifySchema: undefined,
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
              'Ensure family.verifySchema() is exported by your family package',
            );
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54310, databasePort: 54311, shadowDatabasePort: 54312 },
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
        { acceleratePort: 54313, databasePort: 54314, shadowDatabasePort: 54315 },
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
        { acceleratePort: 54316, databasePort: 54317, shadowDatabasePort: 54318 },
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
              const mockedFamily = {
                ...config.family,
                verifySchema: vi.fn().mockResolvedValue({
                  issues: [
                    {
                      kind: 'missing_table',
                      table: 'test',
                      message: 'Table test is missing',
                    },
                  ],
                }),
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
        { acceleratePort: 54319, databasePort: 54320, shadowDatabasePort: 54321 },
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
            // Import and set up mock BEFORE creating command to ensure it's in place
            const configLoaderModule = await import('../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const verifySchemaMock = vi.fn().mockResolvedValue({
              issues: [],
            });
            const loadConfigSpy = vi
              .spyOn(configLoaderModule, 'loadConfig')
              .mockImplementation(async (path) => {
                const config = await originalLoadConfig(path);
                const mockedFamily = {
                  ...config.family,
                  verifySchema: verifySchemaMock,
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
            }

            // Verify mock was called (should be called by verifyDatabaseSchema -> loadConfig)
            expect(loadConfigSpy).toHaveBeenCalled();
            expect(verifySchemaMock).toHaveBeenCalledOnce();
            // Note: --strict flag is passed to verifySchemaAgainstContract, not to the family hook

            // Restore mocks after assertions
            vi.restoreAllMocks();

            // Check exit code is non-zero (error)
            const exitCode = getExitCode();
            expect(exitCode).not.toBe(0);

            // Verify output is JSON (schema verification failures output to stdout, not stderr)
            const output = consoleOutput.join('\n').trim();
            if (output) {
              // Extract JSON from output (might have extra whitespace or newlines)
              const jsonStart = output.indexOf('{');
              const jsonEnd = output.lastIndexOf('}') + 1;
              if (jsonStart !== -1 && jsonEnd > 0) {
                const jsonOutput = output.substring(jsonStart, jsonEnd);
                expect(() => JSON.parse(jsonOutput)).not.toThrow();
              }
            }
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54322, databasePort: 54323, shadowDatabasePort: 54324 },
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
                const output = consoleOutput.join('\n');
                if (errorOutput) {
                  console.error('Command failed with errors:', errorOutput);
                }
                if (output) {
                  console.error('Command output:', output);
                  // Try to parse JSON output to see what issues were reported
                  try {
                    const parsed = JSON.parse(output);
                    if (parsed.schema?.issues) {
                      console.error(
                        'Schema issues:',
                        JSON.stringify(parsed.schema.issues, null, 2),
                      );
                    }
                  } catch {
                    // Not JSON, ignore
                  }
                }
                throw error;
              }
            } finally {
              process.chdir(originalCwd);
            }

            // Check exit code is 0 (success)
            const exitCode = getExitCode();
            const errorOutput = consoleErrors.join('\n');
            const output = consoleOutput.join('\n');

            if (exitCode !== 0) {
              console.error('Unexpected exit code:', exitCode);
              if (errorOutput) {
                console.error('Error output:', errorOutput);
              }
              if (output) {
                console.error('Standard output:', output);
                // Try to parse JSON output to see what issues were reported
                try {
                  const parsed = JSON.parse(output);
                  console.error('Parsed result:', JSON.stringify(parsed, null, 2));
                  if (parsed.schema?.issues) {
                    console.error('Schema issues:', JSON.stringify(parsed.schema.issues, null, 2));
                  }
                } catch {
                  // Not JSON, ignore
                }
              }
            }

            // Always try to parse output to see what we got
            if (output) {
              try {
                const parsed = JSON.parse(output);
                console.log('Verification result:', JSON.stringify(parsed, null, 2));
              } catch {
                // Not JSON, ignore
              }
            }

            expect(exitCode).toBe(0);

            // Parse and verify JSON output
            // Extract JSON from output (might have extra whitespace, newlines, or success message)
            const fullOutput = consoleOutput.join('\n');
            // Find the JSON object in the output (starts with { and ends with })
            // When --json is used, JSON is output first, then potentially a success message
            // We need to find the complete JSON object by matching braces
            const jsonStart = fullOutput.indexOf('{');
            if (jsonStart === -1) {
              throw new Error(`No JSON found in output: ${fullOutput.substring(0, 200)}`);
            }
            // Find the matching closing brace by counting braces
            let braceCount = 0;
            let jsonEnd = jsonStart;
            for (let i = jsonStart; i < fullOutput.length; i++) {
              if (fullOutput[i] === '{') {
                braceCount++;
              } else if (fullOutput[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
            if (jsonEnd === jsonStart) {
              throw new Error(`Incomplete JSON in output: ${fullOutput.substring(0, 200)}`);
            }
            const jsonOutput = fullOutput.substring(jsonStart, jsonEnd).trim();
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
        { acceleratePort: 54325, databasePort: 54326, shadowDatabasePort: 54327 },
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
            const issues = parsed.schema.issues as Array<{
              kind: string;
              table: string;
              column?: string;
              message: string;
            }>;
            const typeMismatchIssues = issues.filter((issue) => issue.kind === 'type_mismatch');
            const primaryKeyIssues = issues.filter(
              (issue) => issue.kind === 'primary_key_mismatch',
            );

            expect(typeMismatchIssues.length).toBeGreaterThan(0);
            expect(primaryKeyIssues.length).toBeGreaterThan(0);

            // Verify coreHash matches
            expect(parsed.contract.coreHash).toBe(contract.coreHash);
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54328, databasePort: 54329, shadowDatabasePort: 54330 },
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
        { acceleratePort: 54331, databasePort: 54332, shadowDatabasePort: 54333 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
