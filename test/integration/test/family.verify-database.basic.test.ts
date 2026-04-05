import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import type { VerifyDatabaseResult } from '@prisma-next/core-control-plane/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import { emit } from '@prisma-next/emitter';
import sql from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
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
import { createIntegrationTestDir } from './utils/cli-test-helpers';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): Contract<SqlStorage> {
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
 * Emits the contract to disk using the family instance.
 * Returns the validated contract for use in tests.
 */
async function emitContract(
  contract: Contract<SqlStorage>,
  testDir: string,
): Promise<Contract<SqlStorage>> {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
  });

  const emitResult = await emit(contract as unknown as Contract, stack, sqlTargetFamilyHook);

  // Write contract files
  const contractJsonPath = resolve(testDir, 'output/contract.json');
  const contractDtsPath = resolve(testDir, 'output/contract.d.ts');
  mkdirSync(dirname(contractJsonPath), { recursive: true });
  mkdirSync(dirname(contractDtsPath), { recursive: true });
  writeFileSync(contractJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(contractDtsPath, emitResult.contractDts, 'utf-8');

  const contractJson = JSON.parse(emitResult.contractJson) as Record<string, unknown>;
  return validateContract<Contract<SqlStorage>>(contractJson);
}

/**
 * Loads contract from disk and validates it.
 */
function loadContract(testDir: string): { contract: Contract; contractPath: string } {
  const contractPath = join(testDir, 'output/contract.json');
  const contractJsonContent = readFileSync(contractPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

  // Create family instance to validate contract
  const familyInstance = sql.create(
    createControlStack({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensionPacks: [],
    }),
  );
  const contract = familyInstance.validateContract(contractJson) as Contract;
  return { contract, contractPath };
}

/**
 * Verifies the database marker against the contract using the family instance.
 * Creates a driver, family instance, and calls verify() with proper cleanup.
 */
async function verifyDatabase(options: {
  contract: Contract;
  dbUrl: string;
  contractPath: string;
  configPath?: string;
}): Promise<VerifyDatabaseResult> {
  const { contract, dbUrl, contractPath, configPath } = options;

  const driver = await postgresDriver.create(dbUrl);
  try {
    const familyInstance = sql.create(
      createControlStack({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensionPacks: [],
      }),
    );

    return await familyInstance.verify({
      driver,
      contract,
      expectedTargetId: postgres.id,
      contractPath,
      ...(configPath ? { configPath } : {}),
    });
  } finally {
    await driver.close();
  }
}

describe('family instance verify - basic', () => {
  it(
    'verifies database with matching marker via driver',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract = createTestContract();
          const contractWithDb = await emitContract(testContract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              storageHash: contractWithDb.storage.storageHash,
              profileHash: contractWithDb.profileHash ?? contractWithDb.storage.storageHash,
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            storageHash: contractWithDb.storage.storageHash,
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
          expect(result.timings.total).toBeGreaterThanOrEqual(0);
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles contract without profileHash',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract2 = createTestContract();
          const contractWithDb = await emitContract(testContract2, testDirWithDb);

          // Modify the contract JSON to remove profileHash
          const contractJsonPath = resolve(testDirWithDb, 'output/contract.json');
          const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
          const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
          // Remove profileHash if present
          if (Object.hasOwn(contractJson, 'profileHash')) {
            const { profileHash: _profileHash, ...contractWithoutProfileHash } = contractJson;
            await writeFile(
              contractJsonPath,
              JSON.stringify(contractWithoutProfileHash, null, 2),
              'utf-8',
            );
          }

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract (using storageHash for profileHash since contract doesn't have it)
            const write = writeContractMarker({
              storageHash: contractWithDb.storage.storageHash,
              profileHash: contractWithDb.storage.storageHash, // Use storageHash since contract doesn't have profileHash
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          // Should succeed and contractProfileHash should be undefined
          expect(result).toMatchObject({
            ok: true,
            summary: 'Database matches contract',
            contract: { storageHash: contractWithDb.storage.storageHash },
            meta: { contractPath: expect.any(String) },
          });
          expect(result.contract.profileHash).toBeUndefined();
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
