import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
} from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import type { SqlStatement } from '../../src/core/migrations/statement-builders';
import {
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
} from '../../src/core/migrations/statement-builders';
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

const testTimeout = timeouts.spinUpPpgDev;

describe.sequential('PostgresMigrationRunner', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await postgresDriverDescriptor.create(database.connectionString);
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
        });
        expect(result.kind).toBe('success');
        if (result.kind !== 'success') {
          throw new Error('expected planner success');
        }

        const executeResult = await runner.execute({
          plan: result.plan,
          driver: driver!,
          destinationContract: contract,
        });
        expect(executeResult).toMatchObject({
          operationsPlanned: result.plan.operations.length,
          operationsExecuted: result.plan.operations.length,
        });

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
        });
        if (initialPlan.kind !== 'success') {
          throw new Error('expected initial planner success');
        }
        await runner.execute({
          plan: initialPlan.plan,
          driver: driver!,
          destinationContract: contract,
        });

        const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          policy: INIT_ADDITIVE_POLICY,
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        const result = await runner.execute({
          plan: emptyPlan,
          driver: driver!,
          destinationContract: contract,
        });
        expect(result).toMatchObject({
          operationsPlanned: 0,
          operationsExecuted: 0,
        });

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

  describe('when an empty plan is executed but the schema does not satisfy the destination contract', () => {
    it(
      'fails with an error and leaves no marker or ledger writes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          policy: INIT_ADDITIVE_POLICY,
          origin: null,
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        await expect(
          runner.execute({
            plan: emptyPlan,
            driver: driver!,
            destinationContract: contract,
          }),
        ).rejects.toThrow(/does not satisfy contract/i);

        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );
  });

  describe('when an operation precheck fails', () => {
    it(
      'fails with an error and leaves no marker or ledger writes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);
        const failingPlan = createFailingPlan();

        await expect(
          runner.execute({
            plan: failingPlan,
            driver: driver!,
            destinationContract: contract,
          }),
        ).rejects.toThrow(/precheck/i);

        await expectNoMarkerOrLedgerWrites(driver!);
      },
    );
  });

  describe('when an existing marker does not match the origin contract', () => {
    it(
      'fails with an error before executing the plan and does not modify marker or append ledger',
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
          policy: INIT_ADDITIVE_POLICY,
          origin: { coreHash: 'sha256:expected-origin', profileHash: 'sha256:expected-profile' },
          destination: toPlanContractInfo(contract),
          operations: [],
        });

        await expect(
          runner.execute({
            plan: emptyPlan,
            driver: driver!,
            destinationContract: contract,
          }),
        ).rejects.toThrow(/does not match plan origin/i);

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
        });

        const planWithFailingStep = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          policy: INIT_ADDITIVE_POLICY,
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

        const result = await runner.execute({
          plan: planWithFailingStep,
          driver: driver!,
          destinationContract: contract,
        });
        expect(result).toMatchObject({
          operationsPlanned: 1,
          operationsExecuted: 0,
        });

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

  describe('when the plan executes but the resulting schema does not satisfy the contract', () => {
    it(
      'fails with an error and leaves no marker or ledger writes',
      { timeout: testTimeout },
      async () => {
        const runner = postgresTargetDescriptor.createRunner(familyInstance);

        const invalidPlan = createMigrationPlan<PostgresPlanTargetDetails>({
          targetId: 'postgres',
          policy: INIT_ADDITIVE_POLICY,
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

        await expect(
          runner.execute({
            plan: invalidPlan,
            driver: driver!,
            destinationContract: contract,
          }),
        ).rejects.toThrow(/does not satisfy contract/i);

        await expectNoMarkerOrLedgerWrites(driver!);

        const tableRow = await driver!.query<{ exists: boolean }>(
          `select to_regclass('public."user"') is not null as exists`,
        );
        expect(tableRow.rows[0]?.exists).toBe(false);
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
          policy: INIT_ADDITIVE_POLICY,
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

        const result = await runner.execute({
          plan: planWithPreSatisfiedPostcheck,
          driver: driver!,
          destinationContract: contract,
        });
        expect(result).toMatchObject({
          operationsPlanned: 1,
          operationsExecuted: 0,
        });

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

async function resetDatabase(driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>>) {
  await driver.query('drop schema if exists public cascade');
  await driver.query('drop schema if exists prisma_contract cascade');
  await driver.query('create schema public');
}

function createFailingPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    policy: INIT_ADDITIVE_POLICY,
    origin: null,
    destination: toPlanContractInfo(contract),
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

async function expectNoMarkerOrLedgerWrites(
  driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>>,
): Promise<void> {
  const markerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('prisma_contract.marker') is not null as exists`,
  );
  const ledgerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('prisma_contract.ledger') is not null as exists`,
  );

  if (markerTableExists.rows[0]?.exists) {
    const markerCount = await driver.query<{ count: string }>(
      'select count(*)::text as count from prisma_contract.marker',
    );
    expect(markerCount.rows[0]?.count ?? '0').toBe('0');
  }

  if (ledgerTableExists.rows[0]?.exists) {
    const ledgerCount = await driver.query<{ count: string }>(
      'select count(*)::text as count from prisma_contract.ledger',
    );
    expect(ledgerCount.rows[0]?.count ?? '0').toBe('0');
  }
}

async function executeStatement(
  driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>>,
  statement: SqlStatement,
): Promise<void> {
  if (statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}
