import postgresAdapterDescriptor, {
  PostgresControlAdapter,
} from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriverDescriptor, {
  PostgresControlDriver,
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
import { createDevDatabase, type DevDatabase } from '@prisma-next/test-utils';
import type { TestTargetAdapter } from '@prisma-next/test-utils/migration-harness';
import { Client } from 'pg';

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
 * Postgres-specific "test driver" — the wrapped control driver that
 * translates `?` placeholders to `$N` so test SQL written sqlite-style
 * works unchanged. Tracks the underlying pg.Client + dev database so the
 * SQL fanout helper can build a runtime against the same connection
 * (`@prisma/dev` allows only one active connection per database).
 */
export interface PostgresTestDriver extends PostgresControlDriver {
  /** Underlying pg.Client — shared with any runtime built via `pgClientFor`. */
  readonly pgClient: Client;
  /** Connection string for the dev database, exposed for callers that prefer URL-based connect. */
  readonly connectionString: string;
}

function wrapPostgresDriverForTests(
  inner: PostgresControlDriver,
  pgClient: Client,
  connectionString: string,
): PostgresTestDriver {
  const wrapper: PostgresControlDriver = {
    familyId: 'sql',
    targetId: 'postgres',
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      let i = 0;
      const translated = sql.replace(/\?/g, () => `$${++i}`);
      return inner.query<Row>(translated, params);
    },
    async close() {
      // No-op: the pg.Client lifecycle is owned by the test target's
      // cleanup, not by the control driver. Closing here would race with
      // any runtime sharing the same client.
    },
  } as PostgresControlDriver;
  return Object.assign(wrapper as PostgresTestDriver, {
    pgClient,
    connectionString,
  });
}

function formatFailure(f: SqlMigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

// Track per-setup state so cleanup knows what to tear down.
interface PostgresSetupState {
  readonly dev: DevDatabase;
  readonly client: Client;
}

const setupState = new WeakMap<PostgresTestDriver, PostgresSetupState>();

/**
 * Internal accessor used by the SQL fanout helper to share the pg.Client
 * and connection string with a runtime built on the same database.
 */
export function getPostgresBinding(driver: PostgresTestDriver): {
  client: Client;
  connectionString: string;
} {
  const state = setupState.get(driver);
  if (!state) {
    throw new Error('Postgres driver was not created by postgresTestTarget.setup()');
  }
  return { client: state.client, connectionString: driver.connectionString };
}

export const postgresTestTarget: TestTargetAdapter<
  Contract<SqlStorage>,
  SqlSchemaIR,
  PostgresTestDriver,
  MigrationOperationPolicy
> = {
  name: 'postgres',
  emptySchema,

  async setup() {
    const dev = await createDevDatabase();
    const client = new Client({ connectionString: dev.connectionString });
    await client.connect();
    // Construct the control driver around our managed client so its
    // close() doesn't end the connection — we'll manage lifecycle here.
    const inner = new PostgresControlDriver(client);
    const driver = wrapPostgresDriverForTests(inner, client, dev.connectionString);
    setupState.set(driver, { dev, client });

    return {
      driver,
      async cleanup() {
        try {
          await client.end();
        } catch {
          /* already ended */
        }
        await dev.close();
        setupState.delete(driver);
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
