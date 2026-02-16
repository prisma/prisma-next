import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
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

describe.sequential('PostgresMigrationPlanner - integration (existing schemas)', () => {
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

  it('returns an empty plan for superset schemas', { timeout: testTimeout }, async () => {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const initialPlan = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    if (initialPlan.kind !== 'success') {
      throw new Error('expected initial plan success');
    }

    const executeResult = await runner.execute({
      plan: initialPlan.plan,
      driver: driver!,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    await driver!.query('create table "extra" (id uuid primary key)');
    const schema = await introspectSchema(driver!);

    const supersetResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    expect(supersetResult).toMatchObject({
      kind: 'success',
      plan: { operations: [] },
    });
  });

  it('plans additive fixes for subset schemas', { timeout: testTimeout }, async () => {
    // Create user table with just id - missing email column, unique, and index
    await driver!.query('create table "user" (id uuid primary key)');
    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);

    const subsetResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(subsetResult.kind).toBe('success');
    if (subsetResult.kind !== 'success') {
      throw new Error('expected planner success for subset');
    }
    // Contract only has 'user' table - should plan missing column, unique, and index
    expect(subsetResult.plan.operations.map((op) => op.id)).toEqual([
      'column.user.email',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
    ]);
  });

  it('fails with conflicts for incompatible schemas', { timeout: testTimeout }, async () => {
    await driver!.query('create table "user" (id uuid primary key, email uuid not null)');
    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);

    const conflictResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(conflictResult).toMatchObject({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'typeMismatch',
          location: { table: 'user', column: 'email' },
        }),
      ],
    });
  });
});

async function introspectSchema(driver: PostgresControlDriver): Promise<SqlSchemaIR> {
  return familyInstance.introspect({
    driver,
    contractIR: contract,
  });
}
