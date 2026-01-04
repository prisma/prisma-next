import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  return defineContract<CodecTypes>()
    .target(postgresPack)
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
 * Returns the contract JSON for use in tests.
 */
async function emitContract(
  contract: SqlContract<SqlStorage>,
  testDir: string,
): Promise<Record<string, unknown>> {
  // Create family instance for emission
  const familyInstance = sql.create({
    target: postgres,
    adapter: postgresAdapter,
    driver: undefined,
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

  return JSON.parse(emitResult.contractJson) as Record<string, unknown>;
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
            const client = createControlClient({
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
            const client = createControlClient({
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
    'verify operation',
    () => {
      it(
        'returns ok: false when marker does not exist',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.verify({
                contractIR: contractJson as never,
              });

              expect(result.ok).toBe(false);
              // Summary contains "Marker missing" (capital M)
              expect(result.summary.toLowerCase()).toContain('marker');
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
    'introspect operation',
    () => {
      it(
        'returns schema IR',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.introspect();

              expect(result).toBeDefined();
              expect(typeof result).toBe('object');
              // The result should be a schema IR with tables
              expect(result).toMatchObject({
                tables: expect.anything(),
              });
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
    'dbInit operation',
    () => {
      it(
        'plans operations without applying',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'plan',
              });

              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.value.mode).toBe('plan');
                expect(result.value.plan.operations.length).toBeGreaterThan(0);
                expect(result.value.summary).toContain('Planned');
              }
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'applies operations and writes marker',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'apply',
              });

              expect(result).toMatchObject({
                ok: true,
                value: {
                  mode: 'apply',
                  execution: expect.anything(),
                  marker: expect.objectContaining({ coreHash: expect.any(String) }),
                  summary: expect.stringContaining('Applied'),
                },
              });

              // Verify marker was written by calling verify
              const verifyResult = await client.verify({
                contractIR: contractJson as never,
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
        'returns success when already at target state',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);

              // Apply first time
              const result1 = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'apply',
              });
              expect(result1.ok).toBe(true);

              // Apply second time - should be idempotent
              const result2 = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'apply',
              });

              expect(result2.ok).toBe(true);
              if (result2.ok) {
                expect(result2.value.plan.operations).toHaveLength(0);
                expect(result2.value.summary).toContain('already at target');
              }
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
    'sign operation',
    () => {
      it(
        'signs database after schema setup',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);

              // First init the database
              const initResult = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'apply',
              });
              expect(initResult.ok).toBe(true);

              // Then sign it (should be idempotent since marker already written)
              const signResult = await client.sign({
                contractIR: contractJson as never,
              });

              expect(signResult.ok).toBe(true);
              expect(signResult.contract.coreHash).toBeDefined();
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
    'schemaVerify operation',
    () => {
      it(
        'verifies schema after db init',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            try {
              await client.connect(connectionString);

              // First init the database
              const initResult = await client.dbInit({
                contractIR: contractJson as never,
                mode: 'apply',
              });
              expect(initResult.ok).toBe(true);

              // Then verify schema
              const schemaResult = await client.schemaVerify({
                contractIR: contractJson as never,
                strict: false,
              });

              expect(schemaResult.ok).toBe(true);
              expect(schemaResult.schema.counts.fail).toBe(0);
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
