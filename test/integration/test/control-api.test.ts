import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createPrismaNextControlClient } from '@prisma-next/cli/control-api';
import type { ContractIR } from '@prisma-next/contract/ir';
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
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  return defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();
}

/**
 * Creates a simple test directory for fixtures.
 */
function createTestDir(): { testDir: string; cleanup: () => void } {
  const testDir = resolve(
    `/tmp/prisma-next-control-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    extensions: [],
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

// ============================================================================
// Tests
// ============================================================================

describe('control-api', () => {
  let testDir: string;
  let testDirCleanup: () => void;

  beforeEach(() => {
    const result = createTestDir();
    testDir = result.testDir;
    testDirCleanup = result.cleanup;
  });

  afterEach(() => {
    testDirCleanup();
  });

  describe(
    'client lifecycle',
    () => {
      it(
        'connects and closes correctly',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            await client.connect(connectionString);
            await client.close();
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'allows reconnect after close',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            await client.connect(connectionString);
            await client.close();
            await client.connect(connectionString);
            await client.close();
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'verify',
    () => {
      it(
        'returns ok:false when marker is missing',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.verify({
                contractIR: emittedContract as unknown as ContractIR,
              });

              expect(result.ok).toBe(false);
              expect(result.code).toBe('PN-RTM-3001');
              expect(result.summary).toBe('Marker missing');
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'returns ok:true when marker matches',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            await withClient(connectionString, async (dbClient) => {
              // Create marker table and write marker
              await executeStatement(dbClient, ensureSchemaStatement);
              await executeStatement(dbClient, ensureTableStatement);

              const marker = writeContractMarker({
                coreHash: emittedContract.coreHash,
                profileHash: (emittedContract as { profileHash?: string }).profileHash ?? '',
                contractJson: emittedContract,
                canonicalVersion: 1,
              });
              await executeStatement(dbClient, marker.insert);
            });

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.verify({
                contractIR: emittedContract as unknown as ContractIR,
              });

              expect(result.ok).toBe(true);
              expect(result.summary).toBe('Database matches contract');
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'sign',
    () => {
      it(
        'creates marker when none exists and schema matches',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            await withClient(connectionString, async (dbClient) => {
              // Create the table structure to satisfy schema verification
              await dbClient.query(`
                CREATE TABLE "user" (
                  id int4 NOT NULL,
                  email text NOT NULL,
                  PRIMARY KEY (id)
                )
              `);
            });

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.sign({
                contractIR: emittedContract as unknown as ContractIR,
              });

              expect(result.ok).toBe(true);
              expect(result.marker.created).toBe(true);
              expect(result.marker.updated).toBe(false);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'is idempotent when marker already matches',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            await withClient(connectionString, async (dbClient) => {
              // Create table structure
              await dbClient.query(`
                CREATE TABLE "user" (
                  id int4 NOT NULL,
                  email text NOT NULL,
                  PRIMARY KEY (id)
                )
              `);
            });

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);

              // First sign
              const result1 = await client.sign({
                contractIR: emittedContract as unknown as ContractIR,
              });
              expect(result1.marker.created).toBe(true);

              // Second sign should be idempotent
              const result2 = await client.sign({
                contractIR: emittedContract as unknown as ContractIR,
              });
              expect(result2.marker.created).toBe(false);
              expect(result2.marker.updated).toBe(false);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'schemaVerify',
    () => {
      it(
        'returns ok:true when schema matches contract',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            await withClient(connectionString, async (dbClient) => {
              // Create matching table structure
              await dbClient.query(`
                CREATE TABLE "user" (
                  id int4 NOT NULL,
                  email text NOT NULL,
                  PRIMARY KEY (id)
                )
              `);
            });

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.schemaVerify({
                contractIR: emittedContract as unknown as ContractIR,
              });

              expect(result.ok).toBe(true);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'returns ok:false when table is missing',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.schemaVerify({
                contractIR: emittedContract as unknown as ContractIR,
              });

              expect(result.ok).toBe(false);
              // The result should have schema issues for missing table
              expect(result.schema.issues.length).toBeGreaterThan(0);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'introspect',
    () => {
      it(
        'returns schema IR',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            await withClient(connectionString, async (dbClient) => {
              // Create a table
              await dbClient.query(`
                CREATE TABLE "test_table" (
                  id serial PRIMARY KEY,
                  name text NOT NULL
                )
              `);
            });

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = (await client.introspect()) as { tables: Record<string, unknown> };

              expect(result).toBeDefined();
              expect(result.tables).toBeDefined();
              expect(result.tables['test_table']).toBeDefined();
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'dbInit',
    () => {
      it(
        'plans operations for missing tables (plan mode)',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contractIR: emittedContract as unknown as ContractIR,
                mode: 'plan',
              });

              expect(result.ok).toBe(true);
              expect(result.mode).toBe('plan');
              expect(result.plan.operations.length).toBeGreaterThan(0);
              // Should not have execution details in plan mode
              expect(result.execution).toBeUndefined();
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'applies operations and writes marker (apply mode)',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contractIR: emittedContract as unknown as ContractIR,
                mode: 'apply',
              });

              expect(result.ok).toBe(true);
              expect(result.mode).toBe('apply');
              expect(result.execution).toBeDefined();
              expect(result.marker).toBeDefined();
              expect(result.marker?.coreHash).toBe(emittedContract.coreHash);

              // Verify marker was written
              const verifyResult = await client.verify({
                contractIR: emittedContract as unknown as ContractIR,
              });
              expect(verifyResult.ok).toBe(true);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'is idempotent when already at target state',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const contract = createTestContract();
            const emittedContract = await emitContract(contract, testDir);

            const client = createPrismaNextControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);

              // First dbInit
              const result1 = await client.dbInit({
                contractIR: emittedContract as unknown as ContractIR,
                mode: 'apply',
              });
              expect(result1.ok).toBe(true);

              // Second dbInit should be idempotent
              const result2 = await client.dbInit({
                contractIR: emittedContract as unknown as ContractIR,
                mode: 'apply',
              });
              expect(result2.ok).toBe(true);
              expect(result2.summary).toBe('Database already at target contract state');
              expect(result2.plan.operations.length).toBe(0);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );
});
