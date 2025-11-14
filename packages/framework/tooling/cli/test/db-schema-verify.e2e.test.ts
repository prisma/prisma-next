import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { emitContract } from '@prisma-next/core-control-plane/emit-contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it(
    'reports PN-CLI-4005 when DB URL is missing',
    async () => {
      // Set up test directory from fixtures without db config
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.ts');
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
    },
  );

  it(
    'reports PN-CLI-4006 when queryRunnerFactory is missing',
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
              code: 'PN-CLI-4006',
              summary: expect.any(String),
              why: expect.any(String),
              fix: expect.any(String),
            });
            expect(parsed.summary).toContain('Query runner factory is required');
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

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              // This will fail because verifySchema hook is not implemented,
              // but we can verify the JSON output format is attempted
              await expect(
                executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']),
              ).rejects.toThrow('process.exit called');
            } finally {
              process.chdir(originalCwd);
            }

            // Check exit code is non-zero (error - verifySchema hook missing)
            const exitCode = getExitCode();
            expect(exitCode).not.toBe(0);

            // Verify error output is JSON
            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();

            const parsed = JSON.parse(errorOutput);
            expect(parsed).toMatchObject({
              code: expect.any(String),
              summary: expect.any(String),
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

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              // This will fail because verifySchema hook is not implemented,
              // but we can verify the command accepts --strict flag
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

            // Check exit code is non-zero (error - verifySchema hook missing)
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
});

