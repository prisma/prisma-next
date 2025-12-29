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
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe.sequential('PostgresMigrationRunner - Idempotency', () => {
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

  describe('when the marker already matches the destination contract (idempotency)', () => {
    it(
      'skips executing operations and still writes marker and ledger',
      { timeout: testTimeout },
      async () => {
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
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        const planWithFailingStep = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'noop.explode',
              label: 'Would fail if executed',
              summary: 'This operation must be skipped when marker matches destination',
              operationClass: 'additive',
              target: {
                id: 'postgres',
                details: {
                  schema: 'public',
                  objectType: 'table',
                  name: 'user',
                },
              },
              precheck: [],
              execute: [
                {
                  description: 'explode',
                  sql: 'select 1/0',
                },
              ],
              postcheck: [],
            },
          ],
        });

        const idempotencyResult = await runner.execute({
          plan: planWithFailingStep,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });
        expect(idempotencyResult.ok).toBe(true);
        if (idempotencyResult.ok) {
          expect(idempotencyResult.value).toMatchObject({
            operationsPlanned: 1,
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

        const ledgerRow = await driver!.query<{ operations: unknown }>(
          'select operations from prisma_contract.ledger order by id desc limit 1',
        );
        expect(ledgerRow.rows[0]?.operations).toEqual([]);
      },
    );
  });

  describe('when the operation postcheck is already satisfied before execution (idempotency)', () => {
    it(
      'skips executing the operation and still writes marker and ledger',
      { timeout: testTimeout },
      async () => {
        await driver!.query(
          'create table "user" (id uuid primary key, email text not null, constraint "user_email_unique" unique (email))',
        );
        await driver!.query('create index "user_email_idx" on "user"(email)');

        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const planWithPreSatisfiedPostcheck = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.user',
              label: 'Create user table',
              summary: 'Skipped because postcheck is already satisfied',
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
                  description: 'would fail if evaluated',
                  sql: 'select false',
                },
              ],
              execute: [
                {
                  description: 'would fail if executed',
                  sql: 'select 1/0',
                },
              ],
              postcheck: [
                {
                  description: 'user table exists',
                  sql: `select to_regclass('public."user"') is not null`,
                },
              ],
            },
          ],
        });

        const postcheckPreSatisfiedResult = await runner.execute({
          plan: planWithPreSatisfiedPostcheck,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });
        expect(postcheckPreSatisfiedResult.ok).toBe(true);
        if (postcheckPreSatisfiedResult.ok) {
          expect(postcheckPreSatisfiedResult.value).toMatchObject({
            operationsPlanned: 1,
            operationsExecuted: 0,
          });
        }

        const markerCount = await driver!.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.marker where id = $1',
          [1],
        );
        expect(markerCount.rows[0]?.count).toBe('1');

        const ledgerRow = await driver!.query<{ operations: unknown }>(
          'select operations from prisma_contract.ledger order by id desc limit 1',
        );
        expect(ledgerRow.rows[0]?.operations).toMatchObject([{ id: 'table.user', execute: [] }]);
      },
    );
  });
});
