import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sqliteAdapterDescriptor, { SqliteControlAdapter } from '@prisma-next/adapter-sqlite/control';
import type { Contract } from '@prisma-next/contract/types';
import sqliteDriverDescriptor from '@prisma-next/driver-sqlite/control';
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
import sqliteTargetDescriptor from '@prisma-next/target-sqlite/control';
import { parseSqliteDefault } from '@prisma-next/target-sqlite/default-normalizer';
import { normalizeSqliteNativeType } from '@prisma-next/target-sqlite/native-type-normalizer';
import type { TestTargetAdapter } from '@prisma-next/test-utils/migration-harness';

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: sqliteTargetDescriptor,
    adapter: sqliteAdapterDescriptor,
    driver: sqliteDriverDescriptor,
    extensionPacks: [],
  }),
);

const fw = [sqliteTargetDescriptor, sqliteAdapterDescriptor, sqliteDriverDescriptor] as const;

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

export interface SqliteTestDriver {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

function formatFailure(f: SqlMigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

export const sqliteTestTarget: TestTargetAdapter<
  Contract<SqlStorage>,
  SqlSchemaIR,
  SqliteTestDriver,
  MigrationOperationPolicy
> = {
  name: 'sqlite',

  emptySchema,

  async setup() {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-mig-spike-'));
    const db = new DatabaseSync(join(dir, 'test.db'));
    db.exec('PRAGMA foreign_keys = ON');
    const driver: SqliteTestDriver = {
      familyId: 'sql',
      targetId: 'sqlite',
      async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
        return {
          rows: db.prepare(sql).all(...((params ?? []) as Array<string | number | null>)) as Row[],
        };
      },
      async close() {
        db.close();
      },
    };
    return {
      driver,
      async cleanup() {
        try {
          db.close();
        } catch {
          /* already closed */
        }
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },

  async applyContract({ driver, currentSchema, contract, fromContract, policy, isInitial }) {
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

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
    const adapter = new SqliteControlAdapter();
    return adapter.introspect(driver);
  },

  verify({ contract, schema, strict = false }) {
    return verifySqlSchema({
      contract,
      schema,
      strict,
      typeMetadataRegistry: familyInstance.typeMetadataRegistry,
      frameworkComponents: fw,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
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
