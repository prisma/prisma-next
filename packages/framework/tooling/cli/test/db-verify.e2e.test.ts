import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
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
import { emitContract } from '../src/api/emit-contract';
import { createDbVerifyCommand } from '../src/commands/db-verify';
import { loadConfig } from '../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../src/pack-assembly';
import {
  executeCommand,
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
    outputJsonPath: resolve(testDir, contractConfig.output ?? 'src/prisma/contract.json'),
    outputDtsPath: resolve(testDir, contractConfig.types ?? 'src/prisma/contract.d.ts'),
    targetFamily: config.family.hook,
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,
  });

  const contractJsonContent = readFileSync(emitResult.files.json, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
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
    'verifies database with matching marker',
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
            let exitCode: number;
            try {
              process.chdir(testDir);
              exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
            } finally {
              process.chdir(originalCwd);
            }

            expect(exitCode).toBe(0);
            // Parse JSON output and verify structure
            const jsonOutput = consoleOutput.join('\n');
            expect(jsonOutput).not.toBe('');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
            expect(parsed).toMatchObject({
              ok: true,
              summary: expect.stringContaining('Database matches contract'),
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

            // Verify coreHash matches
            expect(parsed.contract.coreHash).toBe(contract.coreHash);
            expect(parsed.marker.coreHash).toBe(contract.coreHash);
            expect(consoleErrors.length).toBe(0);
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54070, databasePort: 54071, shadowDatabasePort: 54072 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports error when marker is missing',
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
              const exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
              expect(exitCode).not.toBe(0);
            } finally {
              process.chdir(originalCwd);
            }

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
        { acceleratePort: 54073, databasePort: 54074, shadowDatabasePort: 54075 },
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
              const exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
              expect(exitCode).toBe(0);
            } finally {
              process.chdir(originalCwd);
            }

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
        { acceleratePort: 54076, databasePort: 54077, shadowDatabasePort: 54078 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports error with JSON when marker is missing and --json flag is provided',
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
              const exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
              expect(exitCode).not.toBe(0);
            } finally {
              process.chdir(originalCwd);
            }

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
        { acceleratePort: 54079, databasePort: 54080, shadowDatabasePort: 54081 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4006 when db.queryRunnerFactory is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with config that has db.url but no queryRunnerFactory
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
              const exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
              expect(exitCode).not.toBe(0);
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();

            const parsed = JSON.parse(errorOutput);
            expect(parsed).toMatchObject({
              code: 'PN-CLI-4006',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('Query runner factory is required');
            expect(parsed.fix).toContain('Add db.queryRunnerFactory to prisma-next.config.ts');
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54082, databasePort: 54083, shadowDatabasePort: 54084 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4007 when family.verify.readMarkerSql is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up test directory from fixtures with config that has family without verify
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.no-verify.ts',
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
              const exitCode = await executeCommand(command, [
                '--config',
                'prisma-next.config.ts',
                '--json',
              ]);
              expect(exitCode).not.toBe(0);
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();

            const parsed = JSON.parse(errorOutput);
            expect(parsed).toMatchObject({
              code: 'PN-CLI-4007',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('Family readMarkerSql() is required');
            expect(parsed.fix).toContain(
              'Ensure family.verify.readMarkerSql() is exported by your family package',
            );
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54085, databasePort: 54086, shadowDatabasePort: 54087 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
