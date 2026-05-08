import postgresAdapterDescriptor, {
  PostgresControlAdapter,
} from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriverDescriptor, {
  type PostgresControlDriver,
} from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationRunnerFailure,
} from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import {
  createControlStack,
  type MigrationOperationPolicy,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
import { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
import { createDevDatabase } from '@prisma-next/test-utils';
import type { TestTargetAdapter } from '@prisma-next/test-utils/migration-harness';

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [],
  }),
);

const fw = [postgresTargetDescriptor, postgresAdapterDescriptor, postgresDriverDescriptor] as const;

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

/**
 * Translate `?` placeholders to `$1`, `$2`, … so test SQL written for
 * sqlite-style placeholders runs unchanged on Postgres. The wrapper preserves
 * the `PostgresControlDriver` shape so it remains a `ControlDriverInstance<'sql', 'postgres'>`
 * for `PostgresControlAdapter.introspect`. Introspection queries use `$N`
 * already and contain no `?`, so they pass through unchanged.
 */
function wrapPostgresDriverForTests(inner: PostgresControlDriver): PostgresControlDriver {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      let i = 0;
      const translated = sql.replace(/\?/g, () => `$${++i}`);
      return inner.query<Row>(translated, params);
    },
    async close() {
      return inner.close();
    },
  } as PostgresControlDriver;
}

function formatFailure(f: SqlMigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

export const postgresTestTarget: TestTargetAdapter<
  Contract<SqlStorage>,
  SqlSchemaIR,
  PostgresControlDriver,
  MigrationOperationPolicy
> = {
  name: 'postgres',
  emptySchema,

  async setup() {
    const dev = await createDevDatabase();
    const inner = await postgresDriverDescriptor.create(dev.connectionString);
    // Wrap so test SQL written with `?` placeholders works on Postgres without
    // each test having to dispatch on target. Introspection queries use `$N`
    // already and pass through unchanged.
    const driver = wrapPostgresDriverForTests(inner);
    return {
      driver,
      async cleanup() {
        try {
          await driver.close();
        } catch {
          /* already closed */
        }
        await dev.close();
      },
    };
  },

  async applyContract({ driver, currentSchema, contract, fromContract, policy, isInitial }) {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const effectivePolicy = isInitial ? INIT_ADDITIVE_POLICY : (policy ?? INIT_ADDITIVE_POLICY);

    const planResult = planner.plan({
      contract,
      schema: currentSchema,
      policy: effectivePolicy,
      fromContract,
      frameworkComponents: fw,
    });
    if (planResult.kind !== 'success') {
      throw new Error(
        `Planner failed: ${planResult.conflicts?.map((c) => c.summary).join('; ') ?? 'unknown'}`,
      );
    }

    const runResult = await runner.execute({
      plan: planResult.plan,
      driver,
      destinationContract: contract,
      policy: effectivePolicy,
      frameworkComponents: fw,
      strictVerification: false,
    });
    if (!runResult.ok) {
      throw new Error(`Runner failed: ${formatFailure(runResult.failure)}`);
    }

    return {
      plannedOperationIds: planResult.plan.operations.map((op) => op.id),
      operationsExecuted: runResult.value.operationsExecuted,
    };
  },

  async introspect(driver) {
    const adapter = new PostgresControlAdapter();
    return adapter.introspect(driver);
  },

  verify({ contract, schema, strict = false }) {
    return verifySqlSchema({
      contract,
      schema,
      strict,
      typeMetadataRegistry: familyInstance.typeMetadataRegistry,
      frameworkComponents: fw,
      normalizeDefault: parsePostgresDefault,
      normalizeNativeType: normalizeSchemaNativeType,
    });
  },

  filterUserSchema(schema) {
    const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
    for (const [name, tbl] of Object.entries(schema.tables)) {
      if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
    }
    return { ...schema, tables: userTables };
  },
};
