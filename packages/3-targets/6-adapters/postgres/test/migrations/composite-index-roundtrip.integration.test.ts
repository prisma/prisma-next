/**
 * Regression: `db init` against a fresh database must succeed when a
 * contract declares a composite index whose column order in the index
 * definition differs from the order the columns appear in the table
 * (TML-2516).
 *
 * Pipeline exercised end-to-end:
 *   1. Plan: contract → operations (`PostgresMigrationPlanner.plan`)
 *   2. Apply: operations → live schema (`PostgresMigrationRunner.execute`)
 *   3. Introspect: live schema → SqlSchemaIR (`familyInstance.introspect`)
 *   4. Verify: strict postcondition check inside `execute()`
 *
 * Both axes of the bug are pinned here:
 *   - the table column order in the contract is *not* alphabetical, so the
 *     planner's `Object.entries(contractTable.columns)` ordering matters;
 *   - the index column order is *also* not alphabetical, and differs from
 *     the table column order, so any introspection that sorts by `attnum`
 *     instead of by the position within `pg_index.indkey` produces a
 *     spurious `index_mismatch`.
 */
import { type Contract, coreHash, profileHash as toProfileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const composedContract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: toProfileHash('sha256:test-composite'),
  storage: {
    storageHash: coreHash('sha256:test-composite'),
    tables: {
      sync_run: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          started_at: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
          source: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          entity: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [{ columns: ['source', 'entity', 'started_at'] }],
        foreignKeys: [],
      },
    },
  },
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
};

describe.sequential('Composite index db-init round-trip (TML-2516)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
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

  it('applies a contract with a non-alphabetical composite index and post-init verify passes', {
    timeout: testTimeout,
  }, async () => {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract: composedContract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') {
      throw new Error('expected planner success');
    }

    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: composedContract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    if (!executeResult.ok) {
      throw new Error(`db init failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    // Sanity: the planner+runner stored the index with the contract's
    // declared column order, not alphabetical / table order.
    const schema = await familyInstance.introspect({ driver: driver! });
    const idx = schema.tables['sync_run']?.indexes.find(
      (i) => i.columns.length === 3 && i.columns.includes('source'),
    );
    expect(idx).toBeDefined();
    expect(idx?.columns).toEqual(['source', 'entity', 'started_at']);
  });
});
