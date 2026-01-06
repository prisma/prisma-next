import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import {
  contract,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe.sequential('PostgresMigrationRunner - Basic Execution', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  describe('when the database is empty', () => {
    it(
      'applies an additive plan, creating the schema and writing the marker and ledger',
      { timeout: testTimeout },
      async () => {
        const planner = postgresTargetDescriptor.createPlanner(familyInstance);
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const result = planner.plan({
          contract,
          schema: emptySchema,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });
        expect(result.kind).toBe('success');
        if (result.kind !== 'success') {
          throw new Error('expected planner success');
        }

        const executeResult = await runner.execute({
          plan: result.plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });
        expect(executeResult.ok).toBe(true);
        if (executeResult.ok) {
          expect(executeResult.value).toMatchObject({
            operationsPlanned: result.plan.operations.length,
            operationsExecuted: result.plan.operations.length,
          });
        }

        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(true);

        const markerRow = await driver!.query<{
          core_hash: string;
          profile_hash: string;
        }>('select core_hash, profile_hash from prisma_contract.marker where id = $1', [1]);
        expect(markerRow.rows[0]).toMatchObject({
          core_hash: contract.coreHash,
          profile_hash: contract.profileHash,
        });

        const ledgerRow = await driver!.query<{
          destination_core_hash: string;
          operations: unknown;
        }>(
          'select destination_core_hash, operations from prisma_contract.ledger order by id desc limit 1',
        );
        expect(ledgerRow.rows[0]).toMatchObject({
          destination_core_hash: contract.coreHash,
        });
        expect(Array.isArray(ledgerRow.rows[0]?.operations)).toBe(true);
      },
    );

    it(
      'when the database schema already matches the destination contract, executes an empty plan (0 operations) and still upserts the marker and appends a new ledger entry',
      { timeout: testTimeout },
      async () => {
        const planner = postgresTargetDescriptor.createPlanner(familyInstance);
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const initialPlan = planner.plan({
          contract,
          schema: emptySchema,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });
        if (initialPlan.kind !== 'success') {
          throw new Error('expected initial planner success');
        }
        await runner.execute({
          plan: initialPlan.plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });

        const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        const emptyPlanResult = await runner.execute({
          plan: emptyPlan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });
        expect(emptyPlanResult.ok).toBe(true);
        if (emptyPlanResult.ok) {
          expect(emptyPlanResult.value).toMatchObject({
            operationsPlanned: 0,
            operationsExecuted: 0,
          });
        }

        const markerCount = await driver!.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.marker where id = $1',
          [1],
        );
        expect(markerCount.rows[0]?.count).toBe('1');
        const ledgerCount = await driver!.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.ledger',
        );
        expect(ledgerCount.rows[0]?.count).toBe('2');
      },
    );
  });
});
