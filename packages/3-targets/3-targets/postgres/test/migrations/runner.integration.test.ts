import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
} from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { describe, expect, it, test } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import postgresTargetDescriptor from '../../src/exports/control';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:contract',
  profileHash: 'sha256:profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['email'] }],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
  capabilities: {},
  extensions: {},
  meta: {},
  sources: {},
};

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

const familyInstance = sqlFamilyDescriptor.create({
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [],
});

const shouldRunDbTests = process.env['RUN_POSTGRES_TARGET_TESTS'] === 'true';
const testTimeout = timeouts.spinUpPpgDev * 2;

describe.runIf(shouldRunDbTests)('PostgresMigrationRunner', () => {
  it('applies additive plan and writes marker + ledger', { timeout: testTimeout }, async () => {
    const db = await createIsolatedDatabase(0);
    const driver = await postgresDriverDescriptor.create(db.connectionString);
    try {
      await resetDatabase(db.connectionString);
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const result = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }

      const executeResult = await runner.execute({
        plan: result.plan,
        driver,
        contract,
        contractPath: 'runner.integration.test.ts',
      });
      expect(executeResult).toMatchObject({
        operationsPlanned: result.plan.operations.length,
        operationsExecuted: result.plan.operations.length,
      });

      await withClient(db.connectionString, async (client) => {
        const tableRow = await client.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(true);

        const markerRow = await client.query<{
          core_hash: string;
          profile_hash: string;
        }>('select core_hash, profile_hash from prisma_contract.marker where id = $1', [1]);
        expect(markerRow.rows[0]).toMatchObject({
          core_hash: contract.coreHash,
          profile_hash: contract.profileHash,
        });

        const ledgerRow = await client.query<{
          destination_core_hash: string;
          operations: unknown;
        }>(
          'select destination_core_hash, operations from prisma_contract.ledger order by id desc limit 1',
        );
        expect(ledgerRow.rows[0]).toMatchObject({
          destination_core_hash: contract.coreHash,
        });
        expect(Array.isArray(ledgerRow.rows[0]?.operations)).toBe(true);
      });
    } finally {
      await driver.close();
      await db.close();
    }
  });

  it('handles no-op plans and still upserts marker/ledger', { timeout: testTimeout }, async () => {
    const db = await createIsolatedDatabase(1);
    const driver = await postgresDriverDescriptor.create(db.connectionString);
    try {
      await resetDatabase(db.connectionString);
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const initialPlan = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
      });
      if (initialPlan.kind !== 'success') {
        throw new Error('expected initial planner success');
      }
      await runner.execute({
        plan: initialPlan.plan,
        driver,
        contract,
        contractPath: 'runner.integration.test.ts',
      });

      const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        policy: INIT_ADDITIVE_POLICY,
        contract: toPlanContractInfo(contract),
        operations: [],
      });

      const result = await runner.execute({
        plan: emptyPlan,
        driver,
        contract,
        contractPath: 'runner.integration.test.ts',
      });
      expect(result).toMatchObject({
        operationsPlanned: 0,
        operationsExecuted: 0,
      });

      await withClient(db.connectionString, async (client) => {
        const markerCount = await client.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.marker where id = $1',
          [1],
        );
        expect(markerCount.rows[0]?.count).toBe('1');
        const ledgerCount = await client.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.ledger',
        );
        expect(ledgerCount.rows[0]?.count).toBe('2');
      });
    } finally {
      await driver.close();
      await db.close();
    }
  });

  it(
    'surfaces precheck failures without mutating marker or ledger',
    { timeout: testTimeout },
    async () => {
      const db = await createIsolatedDatabase(2);
      const driver = await postgresDriverDescriptor.create(db.connectionString);
      try {
        await resetDatabase(db.connectionString);
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const failingPlan = createFailingPlan();

        await expect(
          runner.execute({
            plan: failingPlan,
            driver,
            contract,
            contractPath: 'runner.integration.test.ts',
          }),
        ).rejects.toThrow(/precheck/i);

        await withClient(db.connectionString, async (client) => {
          const markerRows = await client.query<{ count: string }>(
            'select count(*)::text as count from prisma_contract.marker',
          );
          expect(markerRows.rows[0]?.count ?? '0').toBe('0');
          const ledgerRows = await client.query<{ count: string }>(
            'select count(*)::text as count from prisma_contract.ledger',
          );
          expect(ledgerRows.rows[0]?.count ?? '0').toBe('0');
        });
      } finally {
        await driver.close();
        await db.close();
      }
    },
  );
});

async function resetDatabase(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query('drop schema if exists public cascade');
    await client.query('drop schema if exists prisma_contract cascade');
    await client.query('create schema public');
  });
}

async function createIsolatedDatabase(slot: number) {
  const basePort = 46000 + slot * 10;
  return createDevDatabase({
    acceleratePort: basePort,
    databasePort: basePort + 1,
    shadowDatabasePort: basePort + 2,
  });
}

function createFailingPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    policy: INIT_ADDITIVE_POLICY,
    contract: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Failing operation',
        summary: 'Precheck always fails',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'user',
          },
        },
        precheck: [
          {
            description: 'always false',
            sql: 'SELECT FALSE',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ],
  });
}

function toPlanContractInfo(contract: SqlContract<SqlStorage>) {
  return contract.profileHash
    ? { coreHash: contract.coreHash, profileHash: contract.profileHash }
    : { coreHash: contract.coreHash };
}
