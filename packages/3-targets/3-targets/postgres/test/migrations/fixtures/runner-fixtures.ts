import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  type SqlMigrationRunnerFailure,
} from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import type { PostgresPlanTargetDetails } from '../../../src/core/migrations/planner-types';
import type { SqlStatement } from '../../../src/core/migrations/statement-builders';
import postgresTargetDescriptor from '../../../src/exports/control';

export const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:contract'),
  profileHash: profileHash('sha256:profile'),
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['email'] }],
        foreignKeys: [],
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

export const emptySchema: SqlSchemaIR = {
  tables: {},
  dependencies: [],
};

export const familyInstance = sqlFamilyDescriptor.create({
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensionPacks: [],
});

export const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
] as const;

export const testTimeout = timeouts.spinUpPpgDev;

export type PostgresControlDriver = Awaited<ReturnType<typeof postgresDriverDescriptor.create>>;

export async function resetDatabase(driver: PostgresControlDriver): Promise<void> {
  await driver.query('drop schema if exists public cascade');
  await driver.query('drop schema if exists prisma_contract cascade');
  await driver.query('create schema public');
}

export function createFailingPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Failing operation',
        summary: 'Precheck always fails',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'user',
          },
        },
        precheck: [
          {
            description: 'always false',
            sql: 'SELECT FALSE',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ],
  });
}

export function toPlanContractInfo(c: SqlContract<SqlStorage>) {
  return { storageHash: c.storageHash, profileHash: c.profileHash! };
}

export async function executeStatement(
  driver: PostgresControlDriver,
  statement: SqlStatement,
): Promise<void> {
  if (statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}

export interface TestContext {
  database: Awaited<ReturnType<typeof createDevDatabase>>;
  driver: PostgresControlDriver | undefined;
}

export async function createTestDatabase(): Promise<Awaited<ReturnType<typeof createDevDatabase>>> {
  return createDevDatabase();
}

export async function createDriver(connectionString: string): Promise<PostgresControlDriver> {
  return postgresDriverDescriptor.create(connectionString);
}

/**
 * Formats a runner failure into a human-readable string for test error messages.
 * Includes code, summary, why, and meta (with issues) for easy debugging.
 */
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

export { postgresTargetDescriptor, createMigrationPlan, postgresDriverDescriptor };
