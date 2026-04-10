import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import {
  contract,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Basic Execution', () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('applies an additive plan, creating the table and writing marker and ledger', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');

    const executeResult = await runner.execute({
      plan: result.plan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
      strictVerification: false,
    });
    if (!executeResult.ok) {
      throw new Error(formatRunnerFailure(executeResult.failure));
    }
    expect(executeResult.value).toMatchObject({
      operationsPlanned: result.plan.operations.length,
      operationsExecuted: result.plan.operations.length,
    });

    const tableRow = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(tableRow.rows[0]!.cnt).toBe(1);

    const markerRow = await driver.query<{ core_hash: string; profile_hash: string }>(
      'SELECT core_hash, profile_hash FROM _prisma_marker WHERE id = ?',
      [1],
    );
    expect(markerRow.rows[0]).toMatchObject({
      core_hash: contract.storage.storageHash,
      profile_hash: contract.profileHash,
    });

    const ledgerRow = await driver.query<{ destination_core_hash: string; operations: string }>(
      'SELECT destination_core_hash, operations FROM _prisma_ledger ORDER BY id DESC LIMIT 1',
    );
    expect(ledgerRow.rows[0]).toMatchObject({
      destination_core_hash: contract.storage.storageHash,
    });
    expect(Array.isArray(JSON.parse(ledgerRow.rows[0]!.operations))).toBe(true);
  });

  it('when schema already matches, executes empty plan and still upserts marker and appends ledger', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const initialPlan = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    if (initialPlan.kind !== 'success') throw new Error('expected initial planner success');
    const firstResult = await runner.execute({
      plan: initialPlan.plan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
      strictVerification: false,
    });
    if (!firstResult.ok) throw new Error(formatRunnerFailure(firstResult.failure));

    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
    });

    const emptyPlanResult = await runner.execute({
      plan: emptyPlan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
      strictVerification: false,
    });
    if (!emptyPlanResult.ok) throw new Error(formatRunnerFailure(emptyPlanResult.failure));
    expect(emptyPlanResult.value).toMatchObject({
      operationsPlanned: 0,
      operationsExecuted: 0,
    });

    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker WHERE id = ?',
      [1],
    );
    expect(markerCount.rows[0]!.cnt).toBe(1);

    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    expect(ledgerCount.rows[0]!.cnt).toBe(2);
  });
});
