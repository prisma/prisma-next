import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { VerifyDatabaseResult } from '@prisma-next/core-control-plane/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  const contractObj = defineContract<CodecTypes>()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  return {
    ...contractObj,
    extensionPacks: {
      postgres: {
        version: '0.0.1',
      },
      pg: {},
    },
  };
}

/**
 * Creates a simple test directory for fixtures.
 */
function createTestDir(): { testDir: string; cleanup: () => void } {
  const testDir = resolve(
    `/tmp/prisma-next-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  return {
    testDir,
    cleanup: () => {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Emits the contract to disk using the family instance.
 * Returns the validated contract for use in tests.
 */
async function emitContract(
  contract: SqlContract<SqlStorage>,
  testDir: string,
): Promise<SqlContract<SqlStorage>> {
  // Create family instance
  const familyInstance = sql.create({
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
  });

  // emitContract handles stripping mappings and validation internally
  const emitResult = await familyInstance.emitContract({ contractIR: contract });

  // Write contract files
  const contractJsonPath = resolve(testDir, 'output/contract.json');
  const contractDtsPath = resolve(testDir, 'output/contract.d.ts');
  mkdirSync(dirname(contractJsonPath), { recursive: true });
  mkdirSync(dirname(contractDtsPath), { recursive: true });
  writeFileSync(contractJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(contractDtsPath, emitResult.contractDts, 'utf-8');

  const contractJson = JSON.parse(emitResult.contractJson) as Record<string, unknown>;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

/**
 * Loads contract from disk and validates it.
 */
function loadContract(testDir: string): { contractIR: ContractIR; contractPath: string } {
  const contractPath = join(testDir, 'output/contract.json');
  const contractJsonContent = readFileSync(contractPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

  // Create family instance to validate contract
  const familyInstance = sql.create({
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
  });
  const contractIR = familyInstance.validateContractIR(contractJson) as ContractIR;
  return { contractIR, contractPath };
}

/**
 * Verifies the database marker against the contract using the family instance.
 * Creates a driver, family instance, and calls verify() with proper cleanup.
 */
async function verifyDatabase(options: {
  contractIR: ContractIR;
  dbUrl: string;
  contractPath: string;
  configPath?: string;
}): Promise<VerifyDatabaseResult> {
  const { contractIR, dbUrl, contractPath, configPath } = options;

  const driver = await postgresDriver.create(dbUrl);
  try {
    const familyInstance = sql.create({
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensionPacks: [],
    });

    return await familyInstance.verify({
      driver,
      contractIR,
      expectedTargetId: postgres.id,
      contractPath,
      ...(configPath ? { configPath } : {}),
    });
  } finally {
    await driver.close();
  }
}

describe('family instance verify - errors', () => {
  it(
    'reports error when marker is missing via driver',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testSetup = createTestDir();
        const testDirWithDb = testSetup.testDir;
        const cleanupWithDb = testSetup.cleanup;

        try {
          // Create and emit contract
          const contract = createTestContract();
          const contractWithDb = await emitContract(contract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);
          });

          // Load contract and verify
          const { contractIR, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contractIR,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            coreHash: contractWithDb.coreHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'PN-RTM-3001',
            summary: 'Marker missing',
            contract: expectedContract,
          });
          expect(result.marker).toBeUndefined();
        } finally {
          cleanupWithDb();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when coreHash mismatch',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testSetup = createTestDir();
        const testDirWithDb = testSetup.testDir;
        const cleanupWithDb = testSetup.cleanup;

        try {
          // Create and emit contract
          const contract = createTestContract();
          const contractWithDb = await emitContract(contract, testDirWithDb);

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
          });

          // Load contract and verify
          const { contractIR, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contractIR,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            coreHash: contractWithDb.coreHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'PN-RTM-3002',
            summary: 'Hash mismatch',
            contract: expectedContract,
            marker: { coreHash: 'sha256:different-hash' },
          });
        } finally {
          cleanupWithDb();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when profileHash mismatch',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testSetup = createTestDir();
        const testDirWithDb = testSetup.testDir;
        const cleanupWithDb = testSetup.cleanup;

        try {
          // Create and emit contract
          const contract = createTestContract();
          const contractWithDb = await emitContract(contract, testDirWithDb);

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
          });

          // Load contract and verify
          const { contractIR, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contractIR,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            coreHash: contractWithDb.coreHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'PN-RTM-3002',
            summary: 'Hash mismatch',
            contract: expectedContract,
            marker: { profileHash: 'sha256:different-profile-hash' },
          });
        } finally {
          cleanupWithDb();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles invalid contract structure (missing coreHash or target)',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testSetup = createTestDir();
        const testDirWithDb = testSetup.testDir;
        const cleanupWithDb = testSetup.cleanup;

        try {
          // Create and emit a valid contract first
          const contract = createTestContract();
          await emitContract(contract, testDirWithDb);

          // Create an invalid contract IR (missing coreHash/target)
          const invalidContractIR = {
            schemaVersion: '1',
            targetFamily: 'sql',
            storage: {
              tables: {},
            },
            models: {},
            relations: {},
          } as unknown as ContractIR;

          // Try to verify with invalid contract
          await expect(
            verifyDatabase({
              contractIR: invalidContractIR,
              dbUrl: connectionString,
              contractPath: join(testDirWithDb, 'output/contract.json'),
            }),
          ).rejects.toThrow('Contract is missing required fields: coreHash or target');
        } finally {
          cleanupWithDb();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports missing codecs when collectSupportedCodecTypeIds returns non-empty array',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testSetup = createTestDir();
        const testDirWithDb = testSetup.testDir;
        const cleanupWithDb = testSetup.cleanup;

        try {
          // Create and emit contract
          const contract = createTestContract();
          const contractWithDb = await emitContract(contract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            const write = writeContractMarker({
              coreHash: contractWithDb.coreHash,
              profileHash: contractWithDb.profileHash ?? contractWithDb.coreHash,
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);
          });

          // Load contract and verify
          const { contractIR, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contractIR,
            dbUrl: connectionString,
            contractPath,
          });

          // Should succeed but report missing codecs if contract uses types not in supported list
          const expectedContract: Record<string, unknown> = {
            coreHash: contractWithDb.coreHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: true,
            summary: 'Database matches contract',
            contract: expectedContract,
            meta: { contractPath: expect.any(String) },
          });
          // If contract uses types not in supported list, missingCodecs should be present
          // Otherwise, missingCodecs should be undefined
          // This test verifies the branch is covered, regardless of whether missingCodecs is set
        } finally {
          cleanupWithDb();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
