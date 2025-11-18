import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FamilyInstance } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDbVerifyCommand } from '../src/commands/db-verify';
import { loadConfig } from '../src/config-loader';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for db-verify tests
const fixtureSubdir = 'db-verify';

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

  // Create family instance (assembles operation registry, type imports, extension IDs)
  if (!config.driver) {
    throw new Error('Config.driver is required');
  }
  const familyInstance = config.family.create({
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensions: config.extensions ?? [],
  }) as FamilyInstance<string>;

  // emitContract handles stripping mappings and validation internally
  const emitResult = await familyInstance.emitContract({ contractIR: contractRaw });

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
          } finally {
            cleanupDir();
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
            await withClient(connectionString, async (client) => {
              // Setup marker schema and table but don't write marker
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);
              // withClient will close the client after this callback returns
            });

            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

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
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54193, databasePort: 54194, shadowDatabasePort: 54195 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'outputs JSON when --json flag is provided via driver',
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
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54196, databasePort: 54197, shadowDatabasePort: 54198 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports error with JSON when marker is missing and --json flag is provided via driver',
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
            await withClient(connectionString, async (client) => {
              // Setup marker schema and table but don't write marker
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);
              // withClient will close the client after this callback returns
            });

            // Emit contract using the config
            await emitContractFromConfig(configPath, testDir);

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
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54199, databasePort: 54200, shadowDatabasePort: 54201 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4010 when driver is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with config that has db.url but no driver
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.no-query-runner.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contract = await emitContractFromConfig(configPath, testDir);

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
            expect(parsed.summary).toContain('Driver is required for DB-connected commands');
            expect(parsed.fix).toContain('Add driver to prisma-next.config.ts');
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54202, databasePort: 54203, shadowDatabasePort: 54204 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
