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
import { emitContract } from '../../src/api/emit-contract';
import { verifyDatabase } from '../../src/api/verify-database';
import { loadConfig } from '../../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../../src/pack-assembly';
import { setupIntegrationTestDirectoryFromFixtures } from '../utils/test-helpers';

// Fixture subdirectory for verify-database tests
const fixtureSubdir = 'verify-database';

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
    outputJsonPath: resolve(testDir, contractConfig.output ?? 'output/contract.json'),
    outputDtsPath: resolve(testDir, contractConfig.types ?? 'output/contract.d.ts'),
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

describe('verifyDatabase API', () => {
  let cleanupDir: () => void;

  beforeEach(() => {
    // Set up test directory from fixtures (no contract emission needed in beforeEach)
    const testSetup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    cleanupDir();
  });

  it(
    'verifies database with matching marker',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Update config with database URL
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDirWithDb = testSetup.testDir;
          const configPathWithDb = testSetup.configPath;
          const cleanupWithDb = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contractWithDb = await emitContractFromConfig(configPathWithDb, testDirWithDb);

            await withClient(connectionString, async (client) => {
              // Setup marker schema and table
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);

              // Write marker matching contract
              const write = writeContractMarker({
                coreHash: contractWithDb.coreHash,
                profileHash: contractWithDb.profileHash ?? contractWithDb.coreHash,
                contractJson: contractWithDb,
                canonicalVersion: 1,
              });
              await executeStatement(client, write.insert);
              // withClient will close the client after this callback returns
            });

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath: configPathWithDb,
            });

            expect(result.ok).toBe(true);
            expect(result.summary).toBe('Database matches contract');
            expect(result.contract.coreHash).toBe(contractWithDb.coreHash);
            if (contractWithDb.profileHash) {
              expect(result.contract.profileHash).toBe(contractWithDb.profileHash);
            }
            expect(result.timings.total).toBeGreaterThanOrEqual(0);
            expect(result.meta?.contractPath).toBeDefined();
          } finally {
            cleanupWithDb();
          }
        },
        { acceleratePort: 54050, databasePort: 54051, shadowDatabasePort: 54052 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when marker is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Update config with database URL
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDirWithDb = testSetup.testDir;
          const configPathWithDb = testSetup.configPath;
          const cleanupWithDb = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contractWithDb = await emitContractFromConfig(configPathWithDb, testDirWithDb);

            await withClient(connectionString, async (client) => {
              // Setup marker schema and table but don't write marker
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);
              // withClient will close the client after this callback returns
            });

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath: configPathWithDb,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3001');
            expect(result.summary).toBe('Marker missing');
            expect(result.marker).toBeUndefined();
            expect(result.contract.coreHash).toBe(contractWithDb.coreHash);
          } finally {
            cleanupWithDb();
          }
        },
        { acceleratePort: 54053, databasePort: 54054, shadowDatabasePort: 54055 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when coreHash mismatch',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Update config with database URL
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDirWithDb = testSetup.testDir;
          const configPathWithDb = testSetup.configPath;
          const cleanupWithDb = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contractWithDb = await emitContractFromConfig(configPathWithDb, testDirWithDb);

            await withClient(connectionString, async (client) => {
              // Setup marker schema and table
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);

              // Write marker with different hash
              const write = writeContractMarker({
                coreHash: 'sha256:different-hash',
                profileHash: contractWithDb.profileHash ?? contractWithDb.coreHash,
                contractJson: contractWithDb,
                canonicalVersion: 1,
              });
              await executeStatement(client, write.insert);
              // withClient will close the client after this callback returns
            });

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath: configPathWithDb,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3002');
            expect(result.summary).toBe('Hash mismatch');
            expect(result.contract.coreHash).toBe(contractWithDb.coreHash);
            expect(result.marker?.coreHash).toBe('sha256:different-hash');
          } finally {
            cleanupWithDb();
          }
        },
        { acceleratePort: 54056, databasePort: 54057, shadowDatabasePort: 54058 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when profileHash mismatch',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Update config with database URL
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDirWithDb = testSetup.testDir;
          const configPathWithDb = testSetup.configPath;
          const cleanupWithDb = testSetup.cleanup;

          try {
            // Emit contract using the config
            const contractWithDb = await emitContractFromConfig(configPathWithDb, testDirWithDb);

            await withClient(connectionString, async (client) => {
              // Setup marker schema and table
              await executeStatement(client, ensureSchemaStatement);
              await executeStatement(client, ensureTableStatement);

              // Write marker with different profileHash
              const write = writeContractMarker({
                coreHash: contractWithDb.coreHash,
                profileHash: 'sha256:different-profile-hash',
                contractJson: contractWithDb,
                canonicalVersion: 1,
              });
              await executeStatement(client, write.insert);
              // withClient will close the client after this callback returns
            });

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath: configPathWithDb,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3002');
            expect(result.summary).toBe('Hash mismatch');
            if (contractWithDb.profileHash) {
              expect(result.contract.profileHash).toBe(contractWithDb.profileHash);
            }
            expect(result.marker?.profileHash).toBe('sha256:different-profile-hash');
          } finally {
            cleanupWithDb();
          }
        },
        { acceleratePort: 54059, databasePort: 54060, shadowDatabasePort: 54061 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  // Note: Target mismatch test is difficult to simulate because:
  // 1. The contract is emitted from the config, so they always match
  // 2. Modifying the contract.json changes the hash, making the marker invalid
  // 3. The target check happens before hash validation, but requires a valid contract structure
  // This scenario would only occur if someone manually edits contract.json after emission,
  // which is not a realistic use case. The target mismatch check is covered by the implementation.
});
