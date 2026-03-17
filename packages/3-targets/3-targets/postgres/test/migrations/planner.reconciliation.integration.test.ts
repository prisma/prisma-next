import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationOperationPolicy } from '@prisma-next/core-control-plane/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
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

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function makeContract(
  tables: Record<string, StorageTable>,
  hashSuffix = 'default',
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash(`sha256:reconciliation-integ-${hashSuffix}`),
    profileHash: profileHash(`sha256:reconciliation-integ-${hashSuffix}`),
    storage: { tables },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

function makeTable(columns: Record<string, StorageTable['columns'][string]>): StorageTable {
  return {
    columns,
    primaryKey: { columns: [Object.keys(columns)[0]!] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

async function applyBaseline(
  driver: PostgresControlDriver,
  contract: SqlContract<SqlStorage>,
): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(familyInstance);
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    frameworkComponents,
  });
  if (result.kind !== 'success') {
    throw new Error(`baseline planner failed: ${JSON.stringify(result)}`);
  }
  const executeResult = await runner.execute({
    plan: result.plan,
    driver,
    destinationContract: contract,
    policy: INIT_ADDITIVE_POLICY,
    frameworkComponents,
  });
  if (!executeResult.ok) {
    throw new Error(`baseline runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

async function introspectSchema(driver: PostgresControlDriver): Promise<SqlSchemaIR> {
  return familyInstance.introspect({ driver });
}

describe.sequential('PostgresMigrationPlanner - reconciliation integration', () => {
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

  it('applies ALTER COLUMN TYPE from text to integer', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          value: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'alter-type-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          value: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
        }),
      },
      'alter-type-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = 'item'
              AND a.attname = 'value'
              AND a.atttypid = 'int4'::regtype
              AND NOT a.attisdropped
          ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);
  });

  it(
    'applies SET DEFAULT on a column with no prior default',
    { timeout: testTimeout },
    async () => {
      const baselineContract = makeContract(
        {
          config: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            label: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          }),
        },
        'set-default-baseline',
      );
      await applyBaseline(driver!, baselineContract);

      const updatedContract = makeContract(
        {
          config: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            label: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', value: 'untitled' },
            },
          }),
        },
        'set-default-updated',
      );

      const schema = await introspectSchema(driver!);
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const planResult = planner.plan({
        contract: updatedContract,
        schema,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
      }

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const executeResult = await runner.execute({
        plan: planResult.plan,
        driver: driver!,
        destinationContract: updatedContract,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (!executeResult.ok) {
        throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
      }

      const defaultRow = await driver!.query<{ column_default: string | null }>(
        `SELECT column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'config'
             AND column_name = 'label'`,
      );
      expect(defaultRow.rows[0]?.column_default).not.toBeNull();
      expect(defaultRow.rows[0]?.column_default).toContain('untitled');
    },
  );

  it('drops an extra table', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
        extra: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'drop-table-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-table-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const tableExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.extra') IS NOT NULL AS exists`,
    );
    expect(tableExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra column', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          extra: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-column-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-column-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const colExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'item'
              AND column_name = 'extra'
          ) AS exists`,
    );
    expect(colExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra index', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['name'], name: 'item_name_idx' }],
          foreignKeys: [],
        },
      },
      'drop-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-index-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_name_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra unique constraint', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            code: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['code'], name: 'item_code_key' }],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-unique-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          code: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'drop-unique-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const constraintExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'item_code_key'
              AND connamespace = 'public'::regnamespace
          ) AS exists`,
    );
    expect(constraintExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra foreign key', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child_parent_id_idx' }],
          foreignKeys: [
            {
              columns: ['parent_id'],
              references: { table: 'parent', columns: ['id'] },
              name: 'child_parent_id_fkey',
              constraint: true,
              index: true,
            },
          ],
        },
      },
      'drop-fk-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'drop-fk-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const fkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'child_parent_id_fkey'
              AND connamespace = 'public'::regnamespace
          ) AS exists`,
    );
    expect(fkExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra primary key', { timeout: testTimeout }, async () => {
    // Baseline: table with a PK
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-pk-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated: same table without PK
    const updatedContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-pk-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const pkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'item_pkey'
              AND connamespace = 'public'::regnamespace
              AND contype = 'p'
          ) AS exists`,
    );
    expect(pkExists.rows[0]?.exists).toBe(false);
  });

  it('drops NOT NULL (widens nullability)', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'drop-notnull-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-notnull-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const nullable = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'item'
             AND column_name = 'name'`,
    );
    expect(nullable.rows[0]?.is_nullable).toBe('YES');
  });

  it('sets NOT NULL (tightens nullability)', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'set-notnull-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'set-notnull-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const nullable = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'item'
             AND column_name = 'name'`,
    );
    expect(nullable.rows[0]?.is_nullable).toBe('NO');
  });

  it(
    'applies ALTER DEFAULT to change an existing column default',
    { timeout: testTimeout },
    async () => {
      const baselineContract = makeContract(
        {
          config: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            status: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', value: 'draft' },
            },
          }),
        },
        'alter-default-baseline',
      );
      await applyBaseline(driver!, baselineContract);

      const updatedContract = makeContract(
        {
          config: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            status: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', value: 'active' },
            },
          }),
        },
        'alter-default-updated',
      );

      const schema = await introspectSchema(driver!);
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const planResult = planner.plan({
        contract: updatedContract,
        schema,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
      }

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const executeResult = await runner.execute({
        plan: planResult.plan,
        driver: driver!,
        destinationContract: updatedContract,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (!executeResult.ok) {
        throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
      }

      const defaultRow = await driver!.query<{ column_default: string | null }>(
        `SELECT column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'config'
             AND column_name = 'status'`,
      );
      expect(defaultRow.rows[0]?.column_default).not.toBeNull();
      expect(defaultRow.rows[0]?.column_default).toContain('active');
      expect(defaultRow.rows[0]?.column_default).not.toContain('draft');
    },
  );

  // ==========================================================================
  // Compound scenarios — multiple reconciliation operations in a single plan
  // ==========================================================================

  it('changes column type and default together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'active' },
          },
        }),
      },
      'compound-type-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            default: { kind: 'literal', value: 1 },
          },
        }),
      },
      'compound-type-default-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'config'
            AND a.attname = 'status'
            AND a.atttypid = 'int4'::regtype
            AND NOT a.attisdropped
        ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'config'
           AND column_name = 'status'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('1');
  });

  it('tightens nullability and adds a default together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-null-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'unknown' },
          },
        }),
      },
      'compound-null-default-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const colInfo = await driver!.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'config'
           AND column_name = 'label'`,
    );
    expect(colInfo.rows[0]?.is_nullable).toBe('NO');
    expect(colInfo.rows[0]?.column_default).not.toBeNull();
    expect(colInfo.rows[0]?.column_default).toContain('unknown');
  });

  it('drops a foreign key and its parent table', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child_parent_id_idx' }],
          foreignKeys: [
            {
              columns: ['parent_id'],
              references: { table: 'parent', columns: ['id'] },
              name: 'child_parent_id_fkey',
              constraint: true,
              index: true,
            },
          ],
        },
      },
      'compound-fk-table-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated contract: keep child table but remove FK, and remove parent table entirely
    const updatedContract = makeContract(
      {
        child: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'compound-fk-table-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const fkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'child_parent_id_fkey'
            AND connamespace = 'public'::regnamespace
        ) AS exists`,
    );
    expect(fkExists.rows[0]?.exists).toBe(false);

    const parentExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.parent') IS NOT NULL AS exists`,
    );
    expect(parentExists.rows[0]?.exists).toBe(false);
  });

  it('drops a column and its index together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            extra: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['extra'], name: 'item_extra_idx' }],
          foreignKeys: [],
        },
      },
      'compound-col-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated contract: remove the column (and its index)
    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-col-index-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const colExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'item'
            AND column_name = 'extra'
        ) AS exists`,
    );
    expect(colExists.rows[0]?.exists).toBe(false);

    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_extra_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(false);
  });

  it(
    'widens and tightens nullability on different columns of the same table',
    { timeout: testTimeout },
    async () => {
      const baselineContract = makeContract(
        {
          item: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            col_a: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            col_b: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          }),
        },
        'compound-mixed-null-baseline',
      );
      await applyBaseline(driver!, baselineContract);

      // Flip both: col_a becomes nullable (widening), col_b becomes NOT NULL (destructive)
      const updatedContract = makeContract(
        {
          item: makeTable({
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            col_a: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            col_b: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          }),
        },
        'compound-mixed-null-updated',
      );

      const schema = await introspectSchema(driver!);
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const planResult = planner.plan({
        contract: updatedContract,
        schema,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
      }

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const executeResult = await runner.execute({
        plan: planResult.plan,
        driver: driver!,
        destinationContract: updatedContract,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      });
      if (!executeResult.ok) {
        throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
      }

      const colA = await driver!.query<{ is_nullable: string }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item'
           AND column_name = 'col_a'`,
      );
      expect(colA.rows[0]?.is_nullable).toBe('YES');

      const colB = await driver!.query<{ is_nullable: string }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item'
           AND column_name = 'col_b'`,
      );
      expect(colB.rows[0]?.is_nullable).toBe('NO');
    },
  );

  it('changes column type when column has an index', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            value: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['value'], name: 'item_value_idx' }],
          foreignKeys: [],
        },
      },
      'compound-type-with-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Change column type but keep the index
    const updatedContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            value: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['value'], name: 'item_value_idx' }],
          foreignKeys: [],
        },
      },
      'compound-type-with-index-updated',
    );

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const planResult = planner.plan({
      contract: updatedContract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      plan: planResult.plan,
      driver: driver!,
      destinationContract: updatedContract,
      policy: RECONCILIATION_POLICY,
      frameworkComponents,
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    // Verify type changed
    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'item'
            AND a.attname = 'value'
            AND a.atttypid = 'int4'::regtype
            AND NOT a.attisdropped
        ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);

    // Verify index still exists
    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_value_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(true);
  });
});
