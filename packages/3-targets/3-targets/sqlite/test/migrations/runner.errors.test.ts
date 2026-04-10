import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import {
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
} from '../../src/core/migrations/statement-builders';
import {
  contract,
  createFailingPlan,
  createMigrationPlan,
  createTestDatabase,
  executeStatement,
  expectNoMarkerOrLedgerWrites,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Error Scenarios', () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails with SCHEMA_VERIFY_FAILED when empty plan on empty database', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
    });

    const result = await runner.execute({
      plan: emptyPlan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('SCHEMA_VERIFY_FAILED');

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with PRECHECK_FAILED when operation precheck fails', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const failingPlan = createFailingPlan();

    const result = await runner.execute({
      plan: failingPlan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('PRECHECK_FAILED');
    expect(failure.summary).toMatch(/precheck/i);

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with MARKER_ORIGIN_MISMATCH when existing marker does not match plan origin', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    await executeStatement(driver, ensureMarkerTableStatement);
    await executeStatement(driver, ensureLedgerTableStatement);
    const mismatchedMarker = buildWriteMarkerStatements({
      storageHash: 'sha256:other-contract',
      profileHash: 'sha256:other-profile',
      contractJson: { storageHash: 'sha256:other-contract' },
      canonicalVersion: null,
      meta: {},
    });
    await executeStatement(driver, mismatchedMarker.insert);

    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: {
        storageHash: 'sha256:expected-origin',
        profileHash: 'sha256:expected-profile',
      },
      destination: toPlanContractInfo(contract),
      operations: [],
    });

    const result = await runner.execute({
      plan: emptyPlan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MARKER_ORIGIN_MISMATCH');
    expect(failure.summary).toMatch(/does not match plan origin/i);

    const markerRow = await driver.query<{ core_hash: string; profile_hash: string }>(
      'SELECT core_hash, profile_hash FROM _prisma_marker WHERE id = ?',
      [1],
    );
    expect(markerRow.rows[0]).toMatchObject({
      core_hash: 'sha256:other-contract',
      profile_hash: 'sha256:other-profile',
    });

    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    expect(ledgerCount.rows[0]!.cnt).toBe(0);
  });

  it('fails with POSTCHECK_FAILED when postcheck fails after execution', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithFailingPostcheck = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.test_table',
          label: 'Create test_table but postcheck fails',
          summary: 'Execute runs, but postcheck returns false',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'test_table' } },
          precheck: [],
          execute: [
            {
              description: 'create test_table',
              sql: 'CREATE TABLE "test_table" (id INTEGER PRIMARY KEY)',
            },
          ],
          postcheck: [{ description: 'always returns false', sql: 'SELECT 0' }],
        },
      ],
    });

    const result = await runner.execute({
      plan: planWithFailingPostcheck,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('POSTCHECK_FAILED');
    expect(failure.summary).toMatch(/table\.test_table/i);

    // Table should be rolled back
    const tableRow = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'test_table'",
    );
    expect(tableRow.rows[0]!.cnt).toBe(0);

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with EXECUTION_FAILED when SQL errors during execute step', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithInvalidSql = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.user',
          label: 'Insert into nonexistent table',
          summary: 'SQL references a table that does not exist',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'user' } },
          precheck: [],
          execute: [
            {
              description: 'insert into nonexistent table',
              sql: 'INSERT INTO "nonexistent_table_xyz" (id) VALUES (1)',
            },
          ],
          postcheck: [],
        },
      ],
    });

    const result = await runner.execute({
      plan: planWithInvalidSql,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('EXECUTION_FAILED');
    expect(failure.summary).toMatch(/table\.user.*execution/i);
    expect(failure.meta).toMatchObject({
      operationId: 'table.user',
      stepDescription: 'insert into nonexistent table',
    });

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with DESTINATION_CONTRACT_MISMATCH when plan hash differs from contract', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: { storageHash: 'sha256:plan-hash', profileHash: 'sha256:plan-profile' },
      operations: [],
    });

    const result = await runner.execute({
      plan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('DESTINATION_CONTRACT_MISMATCH');
  });
});

describe('SqliteMigrationRunner - Policy Violations', () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails with POLICY_VIOLATION when operation class not allowed', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithPolicyViolation = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.drop_something',
          label: 'Destructive operation',
          summary: 'Should be rejected by additive-only policy',
          operationClass: 'destructive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'something' } },
          precheck: [],
          execute: [{ description: 'drop table', sql: 'DROP TABLE IF EXISTS "something"' }],
          postcheck: [],
        },
      ],
    });

    const result = await runner.execute({
      plan: planWithPolicyViolation,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('POLICY_VIOLATION');
      expect(result.failure.summary).toMatch(/destructive/i);
      expect(result.failure.why).toMatch(/additive/i);
    }

    await expectNoMarkerOrLedgerWrites(driver);
  });
});
