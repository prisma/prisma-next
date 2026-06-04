import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, { createMigrationPlan } from '@prisma-next/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationPlan,
  type MigrationRunnerFailure,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  type AggregateMigrationEdgeRef,
  buildSynthMigrationEdge,
} from '@prisma-next/migration-tools/aggregate';
import { buildSqlNamespace, SqlStorage } from '@prisma-next/sql-contract/types';
import type { LoweredStatement } from '@prisma-next/sql-relational-core/ast';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { buildControlTableBootstrapQueries } from '@prisma-next/target-postgres/contract-free';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { applicationDomainOf, createDevDatabase, timeouts } from '@prisma-next/test-utils';
import type { PostgresContract } from '../../../src/core/types';
import postgresAdapterDescriptor from '../../../src/exports/control';

export const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('sha256:test'),
  storage: new SqlStorage({
    storageHash: coreHash('sha256:contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
        id: UNBOUND_NAMESPACE_ID,
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
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensionPacks: {},
  meta: {},
};

export const emptySchema: SqlSchemaIR = {
  tables: {},
};

export const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [],
  }),
);

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
    spaceId: APP_SPACE_ID,
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
    providedInvariants: [],
  });
}

export function toPlanContractInfo(c: Contract<SqlStorage>) {
  return { storageHash: c.storage.storageHash, profileHash: c.profileHash };
}

export function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildSynthMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

export const LEDGER_TEST_SPACE_ID = 'ledger-test';

export function createLedgerTestPlan<TDetails extends PostgresPlanTargetDetails>(options: {
  readonly destinationHash: string;
  readonly operations: ReturnType<typeof createMigrationPlan<TDetails>>['operations'];
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
}) {
  return createMigrationPlan<TDetails>({
    targetId: 'postgres',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash, profileHash: contract.profileHash },
    operations: options.operations,
    providedInvariants: [],
  });
}

const postgresControlAdapter = createPostgresAdapter();
const postgresControlLowererContext = { contract: {} as PostgresContract };

export async function bootstrapPostgresControlSchema(driver: PostgresControlDriver): Promise<void> {
  const schemaQuery = buildControlTableBootstrapQueries()[0];
  if (!schemaQuery) {
    throw new Error('expected prisma_contract schema bootstrap query');
  }
  await executeStatement(
    driver,
    postgresControlAdapter.lower(schemaQuery, postgresControlLowererContext),
  );
}

export async function bootstrapPostgresControlTables(driver: PostgresControlDriver): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    await executeStatement(
      driver,
      postgresControlAdapter.lower(query, postgresControlLowererContext),
    );
  }
}

export async function executeStatement(
  driver: PostgresControlDriver,
  statement: LoweredStatement,
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
export function formatRunnerFailure(failure: MigrationRunnerFailure): string {
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

export { createMigrationPlan, postgresDriverDescriptor, postgresTargetDescriptor };
