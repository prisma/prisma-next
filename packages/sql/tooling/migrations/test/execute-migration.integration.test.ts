import { col, contract, fk, pk, storage, table } from '@prisma-next/sql-contract/factories';
import postgresDriver from '@prisma-next/driver-postgres/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgresAdapter from '../../../targets/postgres-adapter/src/exports/control';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { readContractMarker } from '@prisma-next/sql-runtime';
import { SqlMigrationExecutionError } from '../src/errors';
import { executeMigration } from '../src/execute-migration';
import type { SqlMigrationPlan } from '../src/ir';
import { planMigration } from '../src/plan-migration';
import { createEmptySchemaIR } from './plan-migration.basic.test';

/**
 * Helper to read marker from database (for tests).
 */
async function readMarker(
  driver: ControlDriverInstance<'postgres'>,
): Promise<ContractMarkerRecord | null> {
  const markerStatement = readContractMarker();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    throw new Error('Database query returned unexpected result structure');
  }

  // Parse the marker row (simplified version for tests)
  const updatedAt = markerRow.updated_at
    ? markerRow.updated_at instanceof Date
      ? markerRow.updated_at
      : new Date(markerRow.updated_at)
    : new Date();

  let meta: Record<string, unknown> = {};
  if (markerRow.meta) {
    if (typeof markerRow.meta === 'string') {
      try {
        meta = JSON.parse(markerRow.meta);
      } catch {
        meta = {};
      }
    } else if (typeof markerRow.meta === 'object' && markerRow.meta !== null) {
      meta = markerRow.meta as Record<string, unknown>;
    }
  }

  return {
    coreHash: markerRow.core_hash,
    profileHash: markerRow.profile_hash,
    contractJson: markerRow.contract_json ?? null,
    canonicalVersion: markerRow.canonical_version ?? null,
    updatedAt,
    appTag: markerRow.app_tag ?? null,
    meta,
  };
}

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  return contract({
    target: 'postgres',
    coreHash: 'sha256:test',
    storage: storage({
      user: table(
        {
          id: col('int4', 'pg/int4@1', false),
          email: col('text', 'pg/text@1', false),
        },
        {
          pk: pk('id'),
        },
      ),
    }),
    models: {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
        relations: {},
      },
    },
    relations: {},
    mappings: {},
    extensions: {
      postgres: {
        version: '15.0.0',
      },
      pg: {},
    },
  });
}

/**
 * Creates a test contract with multiple tables for testing.
 */
function createMultiTableContract(): SqlContract<SqlStorage> {
  return contract({
    target: 'postgres',
    coreHash: 'sha256:test-multi',
    storage: storage({
      user: table(
        {
          id: col('int4', 'pg/int4@1', false),
          email: col('text', 'pg/text@1', false),
        },
        {
          pk: pk('id'),
        },
      ),
      post: table(
        {
          id: col('int4', 'pg/int4@1', false),
          userId: col('int4', 'pg/int4@1', false),
          title: col('text', 'pg/text@1', false),
        },
        {
          pk: pk('id'),
          fks: [fk(['userId'], 'user', ['id'])],
        },
      ),
    }),
    models: {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
        relations: {},
      },
      Post: {
        storage: { table: 'post' },
        fields: {
          id: { column: 'id' },
          userId: { column: 'userId' },
          title: { column: 'title' },
        },
        relations: {},
      },
    },
    relations: {},
    mappings: {},
    extensions: {
      postgres: {
        version: '15.0.0',
      },
      pg: {},
    },
  });
}

describe('executeMigration integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let connectionString: string | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    connectionString = database.connectionString;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    if (!connectionString) {
      throw new Error('Connection string not set');
    }

    await withClient(connectionString, async (client) => {
      // Clean up any existing tables and marker
      await client.query('drop table if exists prisma_contract.ledger');
      await client.query('drop table if exists prisma_contract.marker');
      await client.query('drop schema if exists prisma_contract');
      await client.query('drop table if exists "post"');
      await client.query('drop table if exists "user"');
    });
  });

  describe('empty DB → full schema', () => {
    it('applies migration plan and updates marker', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const fromContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:empty',
          storage: storage({}),
          models: {},
          relations: {},
          mappings: {},
        }),
      );
      const toContract = validateContract<SqlContract<SqlStorage>>(createTestContract());
      const liveSchema = createEmptySchemaIR();

      // Plan migration
      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: {
          mode: 'init',
          allowedOperationClasses: ['additive', 'widening'],
        },
      });

      expect(plan.operations.length).toBeGreaterThan(0);

      // Execute migration
      const driver = await postgresDriver.create(connectionString);
      const controlAdapter = postgresAdapter.create();
      try {
        const result = await executeMigration({
          plan,
          driver,
          adapter: controlAdapter,
          extensions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.operationsApplied).toBeGreaterThan(0);
        expect(result.markerUpdated).toBe(true);

        // Verify schema was created
        await withClient(connectionString, async (client) => {
          const tableResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'user'
          `);
          expect(tableResult.rows.length).toBe(1);

          const columnResult = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'user'
            ORDER BY ordinal_position
          `);
          expect(columnResult.rows.length).toBe(2);
          expect(columnResult.rows[0]).toMatchObject({
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
          });
          expect(columnResult.rows[1]).toMatchObject({
            column_name: 'email',
            data_type: 'text',
            is_nullable: 'NO',
          });
        });

        // Verify marker was written
        const marker = await readMarker(driver);
        expect(marker).not.toBeNull();
        expect(marker?.coreHash).toBe(toContract.coreHash);
        expect(marker?.profileHash).toBe(toContract.profileHash ?? toContract.coreHash);

        // Verify ledger entry was written
        await withClient(connectionString, async (client) => {
          const ledgerResult = await client.query(`
            SELECT * FROM prisma_contract.ledger
            ORDER BY applied_at DESC
            LIMIT 1
          `);
          expect(ledgerResult.rows.length).toBe(1);
          expect(ledgerResult.rows[0]).toMatchObject({
            from_core_hash: fromContract.coreHash,
            to_core_hash: toContract.coreHash,
            mode: 'init',
            operation_count: result.operationsApplied,
          });
        });
      } finally {
        await driver.close();
      }
    });

    it('applies migration with multiple tables and foreign keys', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const fromContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:empty',
          storage: storage({}),
          models: {},
          relations: {},
          mappings: {},
        }),
      );
      const toContract = validateContract<SqlContract<SqlStorage>>(createMultiTableContract());
      const liveSchema = createEmptySchemaIR();

      // Plan migration
      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: {
          mode: 'init',
          allowedOperationClasses: ['additive', 'widening'],
        },
      });

      expect(plan.operations.length).toBeGreaterThan(0);

      // Execute migration
      const driver = await postgresDriver.create(connectionString);
      const controlAdapter = postgresAdapter.create();
      try {
        const result = await executeMigration({
          plan,
          driver,
          adapter: controlAdapter,
          extensions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.operationsApplied).toBeGreaterThan(0);

        // Verify both tables were created
        await withClient(connectionString, async (client) => {
          const userTableResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'user'
          `);
          expect(userTableResult.rows.length).toBe(1);

          const postTableResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'post'
          `);
          expect(postTableResult.rows.length).toBe(1);

          // Verify foreign key was created
          const fkResult = await client.query(`
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'post'
              AND constraint_type = 'FOREIGN KEY'
          `);
          expect(fkResult.rows.length).toBeGreaterThan(0);
        });
      } finally {
        await driver.close();
      }
    });
  });

  describe('no-op plan', () => {
    it('updates marker even when no operations are needed', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const contract = validateContract<SqlContract<SqlStorage>>(createTestContract());

      // Create a plan with no operations (superset case)
      const plan: SqlMigrationPlan = {
        fromContract: contract,
        toContract: contract,
        operations: [],
        mode: 'init',
        summary: 'No operations needed',
      };

      const driver = await postgresDriver.create(connectionString);
      const controlAdapter = postgresAdapter.create();
      try {
        const result = await executeMigration({
          plan,
          driver,
          adapter: controlAdapter,
          extensions: [],
        });

        expect(result.ok).toBe(true);
        expect(result.operationsApplied).toBe(0);
        expect(result.markerUpdated).toBe(true);

        // Verify marker was written
        const marker = await readMarker(driver);
        expect(marker).not.toBeNull();
        expect(marker?.coreHash).toBe(contract.coreHash);

        // Verify ledger entry was written
        await withClient(connectionString, async (client) => {
          const ledgerResult = await client.query(`
            SELECT * FROM prisma_contract.ledger
            ORDER BY applied_at DESC
            LIMIT 1
          `);
          expect(ledgerResult.rows.length).toBe(1);
          expect(ledgerResult.rows[0].operation_count).toBe(0);
        });
      } finally {
        await driver.close();
      }
    });
  });

  describe('marker validation', () => {
    it('fails when marker exists for init mode', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const contract = validateContract<SqlContract<SqlStorage>>(createTestContract());

      // Create marker first
      const driver = await postgresDriver.create(connectionString);
      try {
        await driver.query('create schema if not exists prisma_contract');
        await driver.query(`
          create table if not exists prisma_contract.marker (
            id smallint primary key default 1,
            core_hash text not null,
            profile_hash text not null,
            contract_json jsonb,
            canonical_version int,
            updated_at timestamptz not null default now(),
            app_tag text,
            meta jsonb not null default '{}'
          )
        `);
        await driver.query(
          `insert into prisma_contract.marker (id, core_hash, profile_hash) values (1, $1, $2)`,
          [contract.coreHash, contract.profileHash ?? contract.coreHash],
        );

        // Try to execute init migration
        const plan: SqlMigrationPlan = {
          fromContract: validateContract<SqlContract<SqlStorage>>(
            defineContract<CodecTypes>().target('postgres').build(),
          ),
          toContract: contract,
          operations: [
            {
              kind: 'createTable',
              table: 'user',
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          ],
          mode: 'init',
        };

        const controlAdapter = postgresAdapter.create();
        const result = await executeMigration({
          plan,
          driver,
          adapter: controlAdapter,
          extensions: [],
        });

        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('PN-MIGRATION-EXEC-0001');
        expect(result.error?.message).toContain('marker already exists');
      } finally {
        await driver.close();
      }
    });
  });

  describe('lock contention', () => {
    it('fails when lock is already held', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const fromContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:empty',
          storage: storage({}),
          models: {},
          relations: {},
          mappings: {},
        }),
      );
      const toContract = validateContract<SqlContract<SqlStorage>>(createTestContract());
      const liveSchema = createEmptySchemaIR();

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: {
          mode: 'init',
          allowedOperationClasses: ['additive', 'widening'],
        },
      });

      // Acquire lock in first connection
      const driver1 = await postgresDriver.create(connectionString);
      try {
        await driver1.query('SELECT pg_try_advisory_lock($1)', [BigInt(0x1234567890abcdef)]);

        // Try to execute migration in second connection
        const driver2 = await postgresDriver.create(connectionString);
        const controlAdapter = postgresAdapter.create();
        try {
          const result = await executeMigration({
            plan,
            driver: driver2,
            adapter: controlAdapter,
            extensions: [],
          });

          expect(result.ok).toBe(false);
          expect(result.error?.code).toBe('PN-MIGRATION-LOCK-0001');
          expect(result.error?.message).toContain('already held');
        } finally {
          await driver2.close();
        }
      } finally {
        await driver1.query('SELECT pg_advisory_unlock($1)', [BigInt(0x1234567890abcdef)]);
        await driver1.close();
      }
    });
  });

  describe('partial apply failure', () => {
    it('does not update marker when operation fails', async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      const fromContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:empty',
          storage: storage({}),
          models: {},
          relations: {},
          mappings: {},
        }),
      );
      const toContract = validateContract<SqlContract<SqlStorage>>(createTestContract());

      // Create a plan with an invalid operation (FK to non-existent table)
      const plan: SqlMigrationPlan = {
        fromContract,
        toContract,
        operations: [
          {
            kind: 'createTable',
            table: 'post',
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'nonexistent', columns: ['id'] },
              },
            ],
          },
        ],
        mode: 'init',
      };

      const driver = await postgresDriver.create(connectionString);
      const controlAdapter = postgresAdapter.create();
      try {
        const result = await executeMigration({
          plan,
          driver,
          adapter: controlAdapter,
          extensions: [],
        });

        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('PN-MIGRATION-EXEC-0004');

        // Verify marker was NOT written
        const marker = await readMarker(driver);
        expect(marker).toBeNull();

        // Verify lock was released (no error on close)
        await driver.close();
      } catch (error) {
        // If driver.close() fails, that's okay - lock should be released on connection close
        await driver.close().catch(() => {
          // Ignore cleanup errors
        });
        throw error;
      }
    });
  });
});

