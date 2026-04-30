import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlitePlanTargetDetails } from '@prisma-next/target-sqlite/planner-target-details';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Idempotency', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('skips operation when postcheck is already satisfied before execution', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    // Create the table manually so the postcheck is pre-satisfied
    driver.db.exec(
      'CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL, UNIQUE (email))',
    );
    driver.db.exec('CREATE INDEX "user_email_idx" ON "user"(email)');

    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.user',
          label: 'Create user table',
          summary: 'Skipped because postcheck is already satisfied',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'user' } },
          precheck: [
            {
              description: 'would fail if evaluated',
              sql: "SELECT raise(FAIL, 'must not run precheck')",
            },
          ],
          execute: [
            {
              description: 'would fail if executed',
              sql: "SELECT raise(FAIL, 'must not run execute')",
            },
          ],
          postcheck: [
            {
              description: 'user table exists',
              sql: "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'user'",
            },
          ],
        },
      ],
    });

    const result = await runner.execute({
      plan,
      driver,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
      strictVerification: false,
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
    expect(result.value).toMatchObject({
      operationsPlanned: 1,
      operationsExecuted: 0,
    });

    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker WHERE id = ?',
      [1],
    );
    expect(markerCount.rows[0]!.cnt).toBe(1);

    const ledgerRow = await driver.query<{ operations: string }>(
      'SELECT operations FROM _prisma_ledger ORDER BY id DESC LIMIT 1',
    );
    const storedOps = JSON.parse(ledgerRow.rows[0]!.operations) as Array<{
      id: string;
      execute: unknown[];
    }>;
    expect(storedOps).toHaveLength(1);
    expect(storedOps[0]).toMatchObject({ id: 'table.user', execute: [] });
  });
});
