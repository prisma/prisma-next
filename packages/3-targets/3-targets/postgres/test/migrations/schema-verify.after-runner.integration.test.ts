import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures.ts';

/**
 * Integration tests for schema verification after runner execution.
 *
 * These tests prove that the schema verification primitive correctly detects
 * real database drift that occurs AFTER a successful migration.
 *
 * This is different from runner error tests which verify the runner correctly
 * fails when a plan is invalid. These tests simulate production scenarios where
 * someone manually alters the database after a migration.
 */
describe.sequential('Schema verification after runner - integration', () => {
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

  /**
   * Helper to run a successful migration that creates the schema.
   */
  async function runSuccessfulMigration(d: PostgresControlDriver): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    if (result.kind !== 'success') {
      throw new Error(`Planner failed: ${result.kind}`);
    }

    const executeResult = await runner.execute({
      plan: result.plan,
      driver: d,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    if (!executeResult.ok) {
      throw new Error(`Runner failed: ${executeResult.failure.code}`);
    }
  }

  describe('when schema matches contract after migration', () => {
    it('returns ok: true', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      const result = await familyInstance.schemaVerify({
        driver: driver!,
        contractIR: contract,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });
  });

  describe('when schema is mutated after migration', () => {
    it('detects nullability change (DROP NOT NULL)', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: make email nullable (was NOT NULL)
      await driver!.query('ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL');

      const result = await familyInstance.schemaVerify({
        driver: driver!,
        contractIR: contract,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
        }),
      );
    });

    it('detects missing column (DROP COLUMN)', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: drop the email column
      await driver!.query('ALTER TABLE "user" DROP COLUMN email');

      const result = await familyInstance.schemaVerify({
        driver: driver!,
        contractIR: contract,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_column',
          table: 'user',
          column: 'email',
        }),
      );
    });

    it('detects type change', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: change email type from text to varchar(255)
      // PostgreSQL allows this type change
      await driver!.query('ALTER TABLE "user" ALTER COLUMN email TYPE varchar(255)');

      const result = await familyInstance.schemaVerify({
        driver: driver!,
        contractIR: contract,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'type_mismatch',
          table: 'user',
          column: 'email',
          expected: 'text',
        }),
      );
    });
  });
});
