import { integerColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import type { Contract } from '@prisma-next/contract/types';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { field } from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import {
  type ApplyMigrationOptions,
  applyMigration as baseApplyMigration,
  type MigrationResult,
} from '@prisma-next/test-utils/migration-harness';
import { type SqliteTestDriver, sqliteTestTarget } from '../../migration-targets/sqlite';

export const pack = { family: sqlFamilyPack, target: sqlitePack } as const;
export const int = field.column(integerColumn);
export const text = field.column(textColumn);
export { integerColumn, textColumn };

export type Driver = SqliteTestDriver;

export async function applyMigration(
  options: ApplyMigrationOptions<Contract<SqlStorage>, SqliteTestDriver, MigrationOperationPolicy>,
  runAssertions: (result: MigrationResult<SqlSchemaIR, SqliteTestDriver>) => Promise<void>,
): Promise<void> {
  return baseApplyMigration(sqliteTestTarget, options, runAssertions);
}
