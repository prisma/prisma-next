import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-types';
import { expectNoMarkerOrLedgerWrites } from '../utils/dbAssertions';
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

describe.sequential('PostgresMigrationRunner - Policy Violations', () => {
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

  describe('when an operation violates the policy (operation class not allowed)', () => {
    it(
      'fails with POLICY_VIOLATION error without executing any operations',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const planWithPolicyViolation = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.drop_something',
              label: 'Destructive operation',
              summary: 'This is a destructive operation that should be rejected by policy',
              operationClass: 'destructive', // Not allowed by INIT_ADDITIVE_POLICY
              target: {
                id: 'postgres',
                details: {
                  schema: 'public',
                  objectType: 'table',
                  name: 'something',
                },
              },
              precheck: [],
              execute: [
                {
                  description: 'drop table',
                  sql: 'drop table if exists "something"',
                },
              ],
              postcheck: [],
            },
          ],
        });

        const result = await runner.execute({
          plan: planWithPolicyViolation,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY, // Only allows 'additive'
          frameworkComponents,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('POLICY_VIOLATION');
          expect(result.failure.summary).toMatch(/destructive/i);
          expect(result.failure.why).toMatch(/additive/i);
        }

        // Verify no marker/ledger writes
        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );

    it(
      'succeeds with a policy that allows destructive operations',
      { timeout: testTimeout },
      async () => {
        // Create a table first so we can drop it
        await driver!.query('create table "something" (id serial primary key)');

        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        // Same operation structure as above, but now with a permissive policy
        const planWithDestructiveOp = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.drop_something',
              label: 'Drop table something',
              summary: 'Drops the something table',
              operationClass: 'destructive',
              target: {
                id: 'postgres',
                details: {
                  schema: 'public',
                  objectType: 'table',
                  name: 'something',
                },
              },
              precheck: [],
              execute: [
                {
                  description: 'drop table',
                  sql: 'drop table if exists "something"',
                },
              ],
              postcheck: [
                {
                  description: 'verify table dropped',
                  sql: `select to_regclass('public."something"') is null`,
                },
              ],
            },
          ],
        });

        // Policy that allows destructive operations
        const permissivePolicy = {
          allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
        };

        const result = await runner.execute({
          plan: planWithDestructiveOp,
          driver: driver!,
          destinationContract: contract,
          policy: permissivePolicy,
          frameworkComponents,
        });

        // With a permissive policy, the same plan succeeds
        // (Note: schemaVerify will fail because we're not actually creating the user table,
        // but the policy check itself passes)
        // We expect SCHEMA_VERIFY_FAILED, not POLICY_VIOLATION
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('SCHEMA_VERIFY_FAILED');
        }
      },
    );
  });
});
