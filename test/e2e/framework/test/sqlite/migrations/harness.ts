import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import sqliteAdapterDescriptor, {
  normalizeSqliteNativeType,
  parseSqliteDefault,
  SqliteControlAdapter,
} from '@prisma-next/adapter-sqlite/control';
import type { Contract } from '@prisma-next/contract/types';
import sqliteDriverDescriptor from '@prisma-next/driver-sqlite/control';
import sqlFamilyDescriptor, {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationRunnerFailure,
} from '@prisma-next/family-sql/control';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { field } from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import sqliteTargetDescriptor from '@prisma-next/target-sqlite/control';
import sqlitePack from '@prisma-next/target-sqlite/pack';

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

export const pack = { family: sqlFamilyPack, target: sqlitePack } as const;
export const int = field.column(integerColumn);
export const text = field.column(textColumn);
export { integerColumn, textColumn };

export type Driver = {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
};

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-mig-e2e-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  const driver: Driver = {
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
    cleanup() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

export interface MigrationResult {
  readonly driver: Driver;
  readonly schema: SqlSchemaIR;
  readonly operationsExecuted: number;
}

function formatFailure(f: SqlMigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

export async function applyMigration(
  options: {
    origin?: Contract<SqlStorage>;
    destination: Contract<SqlStorage>;
    policy?: MigrationOperationPolicy;
    seed?: (driver: Driver) => Promise<void>;
  },
  runAssertions: (result: MigrationResult) => Promise<void>,
): Promise<void> {
  const testDb = createTestDb();
  const { driver } = testDb;
  try {
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const adapter = new SqliteControlAdapter();
    const policy = options.policy ?? INIT_ADDITIVE_POLICY;

    let currentSchema: SqlSchemaIR = emptySchema;
    if (options.origin) {
      const r = planner.plan({
        contract: options.origin,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: fw,
      });
      if (r.kind !== 'success') throw new Error('Origin planner failed');
      const run = await runner.execute({
        plan: r.plan,
        driver,
        destinationContract: options.origin,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: fw,
        strictVerification: false,
      });
      if (!run.ok) throw new Error(`Origin runner failed: ${formatFailure(run.failure)}`);
      currentSchema = await adapter.introspect(driver);
    }
    if (options.seed) await options.seed(driver);

    const planResult = planner.plan({
      contract: options.destination,
      schema: currentSchema,
      policy,
      frameworkComponents: fw,
    });
    if (planResult.kind !== 'success') {
      throw new Error(
        `Destination planner failed: ${planResult.conflicts?.map((cf) => cf.summary).join('; ') ?? 'unknown'}`,
      );
    }
    const runResult = await runner.execute({
      plan: planResult.plan,
      driver,
      destinationContract: options.destination,
      policy,
      frameworkComponents: fw,
      strictVerification: false,
    });
    if (!runResult.ok)
      throw new Error(`Destination runner failed: ${formatFailure(runResult.failure)}`);

    const freshSchema = await adapter.introspect(driver);
    const vr = verifySqlSchema({
      contract: options.destination,
      schema: freshSchema,
      strict: false,
      typeMetadataRegistry: familyInstance.typeMetadataRegistry,
      frameworkComponents: fw,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
    });
    if (!vr.ok) {
      throw new Error(
        `Schema verification failed:\n${vr.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n')}`,
      );
    }

    const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
    for (const [name, tbl] of Object.entries(freshSchema.tables)) {
      if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
    }
    await runAssertions({
      driver,
      schema: { ...freshSchema, tables: userTables },
      operationsExecuted: runResult.value.operationsExecuted,
    });
  } finally {
    testDb.cleanup();
  }
}
