import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import {
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
} from '../../src/core/migrations/statement-builders';
import { expectNoMarkerOrLedgerWrites } from '../utils/dbAssertions';
import {
  contract,
  createDriver,
  createFailingPlan,
  createMigrationPlan,
  createTestDatabase,
  executeStatement,
  familyInstance,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe.sequential('PostgresMigrationRunner - Error Scenarios', () => {
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

  describe('when an empty plan is executed but the schema does not satisfy the destination contract', () => {
    it(
      'fails with SCHEMA_VERIFY_FAILED error and leaves no marker or ledger writes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        const result = await runner.execute({
          plan: emptyPlan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('SCHEMA_VERIFY_FAILED');
        }

        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );
  });

  describe('when an operation precheck fails', () => {
    it(
      'fails with PRECHECK_FAILED error and leaves no marker or ledger writes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const failingPlan = createFailingPlan();

        const result = await runner.execute({
          plan: failingPlan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('PRECHECK_FAILED');
          expect(result.failure.summary).toMatch(/precheck/i);
        }

        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );
  });

  describe('when an existing marker does not match the origin contract', () => {
    it(
      'fails with MARKER_ORIGIN_MISMATCH error and does not modify marker or append ledger',
      { timeout: testTimeout },
      async () => {
        await executeStatement(driver!, ensurePrismaContractSchemaStatement);
        await executeStatement(driver!, ensureMarkerTableStatement);
        await executeStatement(driver!, ensureLedgerTableStatement);

        const mismatchedMarker = buildWriteMarkerStatements({
          coreHash: 'sha256:other-contract',
          profileHash: 'sha256:other-profile',
          contractJson: { coreHash: 'sha256:other-contract' },
          canonicalVersion: null,
          meta: {},
        });
        await executeStatement(driver!, mismatchedMarker.insert);

        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: { coreHash: 'sha256:expected-origin', profileHash: 'sha256:expected-profile' },
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        const result = await runner.execute({
          plan: emptyPlan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('MARKER_ORIGIN_MISMATCH');
          expect(result.failure.summary).toMatch(/does not match plan origin/i);
        }

        const markerRow = await driver!.query<{ core_hash: string; profile_hash: string }>(
          'select core_hash, profile_hash from prisma_contract.marker where id = $1',
          [1],
        );
        expect(markerRow.rows[0]).toMatchObject({
          core_hash: 'sha256:other-contract',
          profile_hash: 'sha256:other-profile',
        });

        const ledgerCount = await driver!.query<{ count: string }>(
          'select count(*)::text as count from prisma_contract.ledger',
        );
        expect(ledgerCount.rows[0]?.count).toBe('0');

        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(false);
      },
    );
  });

  describe('when the plan executes but the resulting schema does not satisfy the contract', () => {
    it(
      'fails with SCHEMA_VERIFY_FAILED error and rolls back all changes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const invalidPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.user',
              label: 'Create user table without required columns',
              summary: 'Creates a user table missing contract-required columns',
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
                  description: 'create user table',
                  sql: 'create table "user" (id uuid primary key)',
                },
              ],
              postcheck: [],
            },
          ],
        });

        const result = await runner.execute({
          plan: invalidPlan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('SCHEMA_VERIFY_FAILED');
        }

        await expectNoMarkerOrLedgerWrites(driver!);

        // Verify table was rolled back
        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(false);
      },
    );
  });

  describe('when an operation postcheck fails after execution', () => {
    it(
      'fails with POSTCHECK_FAILED error and rolls back all changes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const planWithFailingPostcheck = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [
            {
              id: 'table.test_table',
              label: 'Create test_table but postcheck fails',
              summary: 'The execute step runs, but postcheck returns false',
              operationClass: 'additive',
              target: {
                id: 'postgres',
                details: {
                  schema: 'public',
                  objectType: 'table',
                  name: 'test_table',
                },
              },
              precheck: [],
              execute: [
                {
                  description: 'create test_table',
                  sql: 'create table "test_table" (id uuid primary key)',
                },
              ],
              postcheck: [
                {
                  description: 'always returns false',
                  sql: 'select false',
                },
              ],
            },
          ],
        });

        const result = await runner.execute({
          plan: planWithFailingPostcheck,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('POSTCHECK_FAILED');
          expect(result.failure.summary).toMatch(/table\.test_table/i);
          expect(result.failure.summary).toMatch(/postcheck/i);
        }

        // Verify table was rolled back
        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."test_table"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(false);

        // Verify no marker/ledger writes
        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );
  });
});
