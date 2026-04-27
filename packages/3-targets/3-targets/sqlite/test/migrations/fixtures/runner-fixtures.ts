import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sqliteAdapterDescriptor from '@prisma-next/adapter-sqlite/control';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import sqliteDriverDescriptor from '@prisma-next/driver-sqlite/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  type SqlMigrationRunnerFailure,
} from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { SqlitePlanTargetDetails } from '../../../src/core/migrations/planner-target-details';
import type { SqlStatement } from '../../../src/core/migrations/statement-builders';
import sqliteTargetDescriptor from '../../../src/exports/control';

export const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('sha256:test'),
  storage: {
    storageHash: coreHash('sha256:contract'),
    tables: {
      user: {
        columns: {
          id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
          email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['email'] }],
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

export const emptySchema: SqlSchemaIR = {
  tables: {},
  dependencies: [],
};

export const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: sqliteTargetDescriptor,
    adapter: sqliteAdapterDescriptor,
    driver: sqliteDriverDescriptor,
    extensionPacks: [],
  }),
);

export const frameworkComponents = [
  sqliteTargetDescriptor,
  sqliteAdapterDescriptor,
  sqliteDriverDescriptor,
] as const;

export type SqliteControlDriver = {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
};

export interface TestDatabase {
  readonly driver: SqliteControlDriver & { db: DatabaseSync };
  readonly path: string;
  cleanup(): void;
}

export function createTestDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  const driver: SqliteControlDriver & { db: DatabaseSync } = {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    db,
  };

  return {
    driver,
    path: dbPath,
    cleanup() {
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function createFailingPlan() {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Failing operation',
        summary: 'Precheck always fails',
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: { schema: 'main', objectType: 'table', name: 'user' },
        },
        precheck: [{ description: 'always false', sql: 'SELECT 0' }],
        execute: [],
        postcheck: [],
      },
    ],
  });
}

export function toPlanContractInfo(c: Contract<SqlStorage>) {
  return { storageHash: c.storage.storageHash, profileHash: c.profileHash };
}

export async function executeStatement(
  driver: SqliteControlDriver,
  statement: SqlStatement,
): Promise<void> {
  if (statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}

export function formatRunnerFailure(failure: SqlMigrationRunnerFailure): string {
  const parts = [`[${failure.code}] ${failure.summary}`];
  if (failure.why) {
    parts.push(`  why: ${failure.why}`);
  }
  if (failure.meta) {
    const issues = failure.meta['issues'];
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        parts.push(`  - ${JSON.stringify(issue)}`);
      }
    } else {
      parts.push(`  meta: ${JSON.stringify(failure.meta, null, 2)}`);
    }
  }
  return parts.join('\n');
}

export async function expectNoMarkerOrLedgerWrites(driver: SqliteControlDriver): Promise<void> {
  const markerExists = await driver.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_prisma_marker'",
  );
  if (markerExists.rows[0]!.cnt > 0) {
    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker',
    );
    if (markerCount.rows[0]!.cnt !== 0) {
      throw new Error(`Expected no marker writes but found ${markerCount.rows[0]!.cnt} rows`);
    }
  }

  const ledgerExists = await driver.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_prisma_ledger'",
  );
  if (ledgerExists.rows[0]!.cnt > 0) {
    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    if (ledgerCount.rows[0]!.cnt !== 0) {
      throw new Error(`Expected no ledger writes but found ${ledgerCount.rows[0]!.cnt} rows`);
    }
  }
}

export { sqliteTargetDescriptor, createMigrationPlan, sqliteDriverDescriptor };
