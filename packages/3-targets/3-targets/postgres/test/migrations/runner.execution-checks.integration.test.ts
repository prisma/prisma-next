import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import {
  contract,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe.sequential('PostgresMigrationRunner - Execution Checks', () => {
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

  describe('when prechecks and postchecks are disabled', () => {
    it(
      'skips prechecks and postchecks, executes operation successfully',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const planWithFailingChecks = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.user',
              label: 'Create user table',
              summary: 'Operation with failing precheck and postcheck that should be skipped',
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
                  description: 'would fail if executed',
                  sql: 'select 1/0',
                },
              ],
              execute: [
                {
                  description: 'create user table',
                  sql: `create table "user" (
                    id uuid primary key,
                    email text not null,
                    constraint "user_email_unique" unique (email)
                  )`,
                },
                {
                  description: 'create index',
                  sql: 'create index "user_email_idx" on "user"(email)',
                },
              ],
              postcheck: [
                {
                  description: 'would fail if executed',
                  sql: 'select 1/0',
                },
              ],
            },
          ],
        });

        const result = await runner.execute({
          plan: planWithFailingChecks,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          executionChecks: {
            prechecks: false,
            postchecks: false,
          },
          frameworkComponents,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toMatchObject({
            operationsPlanned: 1,
            operationsExecuted: 1,
          });
        }

        // Verify the table was actually created
        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(true);
      },
    );
  });

  describe('when idempotency checks are disabled', () => {
    it(
      'skips idempotency probe and executes operation even when postcheck is already satisfied',
      { timeout: testTimeout },
      async () => {
        // Pre-create the table so postcheck would be satisfied
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
              summary: 'Operation that would be skipped by idempotency probe if enabled',
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

        const result = await runner.execute({
          plan: planWithPreSatisfiedPostcheck,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          executionChecks: {
            idempotencyChecks: false,
          },
          frameworkComponents,
        });

        // Should fail because execute step fails (idempotency probe was skipped)
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('EXECUTION_FAILED');
        }
      },
    );
  });
});
