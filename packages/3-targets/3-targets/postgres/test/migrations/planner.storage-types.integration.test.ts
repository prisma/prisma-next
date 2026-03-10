import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { expectNarrowedType } from '@prisma-next/test-utils/typed-expectations';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const contractWithEnum: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:enum-test'),
  profileHash: profileHash('sha256:profile'),
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          role: { nativeType: 'role', codecId: 'pg/enum@1', nullable: false, typeRef: 'Role' },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
    types: {
      Role: {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  sources: {},
};

describe.sequential('PostgresMigrationPlanner - Storage Types Integration', () => {
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

  describe('enum types', () => {
    it('creates enum type and table with enum column', { timeout: testTimeout }, async () => {
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      const planResult = planner.plan({
        contract: contractWithEnum,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      });

      expectNarrowedType(planResult.kind === 'success');

      // Verify plan includes type operation before table operation
      const operationIds = planResult.plan.operations.map((op) => op.id);
      expect(operationIds).toContain('type.Role');
      expect(operationIds).toContain('table.user');
      expect(operationIds.indexOf('type.Role')).toBeLessThan(operationIds.indexOf('table.user'));

      // Execute the plan
      const executeResult = await runner.execute({
        plan: planResult.plan,
        driver: driver!,
        destinationContract: contractWithEnum,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      });

      expect(executeResult.ok).toBe(true);

      // Verify enum type was created
      const enumResult = await driver!.query<{ typname: string }>(`
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typname = 'role'
      `);
      expect(enumResult.rows).toHaveLength(1);
      expect(enumResult.rows[0]?.typname).toBe('role');

      // Verify enum values are correct
      const valuesResult = await driver!.query<{ enumlabel: string }>(`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typname = 'role'
        ORDER BY e.enumsortorder
      `);
      expect(valuesResult.rows.map((r) => r.enumlabel)).toEqual(['USER', 'ADMIN']);

      // Verify table was created with enum column
      const columnResult = await driver!.query<{ udt_name: string }>(`
        SELECT udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user'
          AND column_name = 'role'
      `);
      expect(columnResult.rows).toHaveLength(1);
      expect(columnResult.rows[0]?.udt_name).toBe('role');
    });

    it(
      'skips enum creation when type already exists with matching values',
      { timeout: testTimeout },
      async () => {
        // Pre-create the enum type
        await driver!.query(`CREATE TYPE "public"."role" AS ENUM ('USER', 'ADMIN')`);

        const planner = postgresTargetDescriptor.createPlanner(familyInstance);
        const schema = await familyInstance.introspect({
          driver: driver!,
          contractIR: contractWithEnum,
        });

        const planResult = planner.plan({
          contract: contractWithEnum,
          schema,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        });

        expectNarrowedType(planResult.kind === 'success');

        // Should not include type.Role operation since it already exists
        const operationIds = planResult.plan.operations.map((op) => op.id);
        expect(operationIds).not.toContain('type.Role');
        expect(operationIds).toContain('table.user');
      },
    );

    it(
      'plans add value operations when enum exists with subset of values',
      { timeout: testTimeout },
      async () => {
        // Pre-create enum with only USER value
        await driver!.query(`CREATE TYPE "public"."role" AS ENUM ('USER')`);

        const planner = postgresTargetDescriptor.createPlanner(familyInstance);
        const schema = await familyInstance.introspect({
          driver: driver!,
          contractIR: contractWithEnum,
        });

        const planResult = planner.plan({
          contract: contractWithEnum,
          schema,
          policy: { allowedOperationClasses: ['additive', 'widening'] },
          frameworkComponents,
        });

        expectNarrowedType(planResult.kind === 'success');

        // Should include operation to add ADMIN value
        const operationIds = planResult.plan.operations.map((op) => op.id);
        expect(operationIds).toContain('type.Role.value.ADMIN');
      },
    );
  });
});
