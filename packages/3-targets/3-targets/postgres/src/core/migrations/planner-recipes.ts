import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { PostgresPlanTargetDetails } from './planner';
import {
  buildAddColumnSql,
  columnExistsCheck,
  columnHasNoDefaultCheck,
  columnNullabilityCheck,
  qualifyTableName,
} from './planner-sql';
import { buildTargetDetails } from './planner-target-details';

export function buildAddColumnOperationIdentity(
  schema: string,
  tableName: string,
  columnName: string,
): Pick<
  SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  'id' | 'label' | 'summary' | 'target'
> {
  return {
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} to ${tableName}`,
    summary: `Adds column ${columnName} to table ${tableName}`,
    target: {
      id: 'postgres',
      details: buildTargetDetails('table', tableName, schema),
    },
  };
}

export function buildAddNotNullColumnWithTemporaryDefaultOperation(options: {
  readonly schema: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: StorageColumn;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly temporaryDefault: string;
}): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  const { schema, tableName, columnName, column, codecHooks, temporaryDefault } = options;
  const qualified = qualifyTableName(schema, tableName);

  return {
    ...buildAddColumnOperationIdentity(schema, tableName, columnName),
    operationClass: 'additive',
    precheck: [
      {
        description: `ensure column "${columnName}" is missing`,
        sql: columnExistsCheck({ schema, table: tableName, column: columnName, exists: false }),
      },
    ],
    execute: [
      {
        description: `add column "${columnName}"`,
        sql: buildAddColumnSql(qualified, columnName, column, codecHooks, temporaryDefault),
      },
      {
        description: `drop temporary default from column "${columnName}"`,
        sql: `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} DROP DEFAULT`,
      },
    ],
    postcheck: [
      {
        description: `verify column "${columnName}" exists`,
        sql: columnExistsCheck({ schema, table: tableName, column: columnName }),
      },
      {
        description: `verify column "${columnName}" is NOT NULL`,
        sql: columnNullabilityCheck({
          schema,
          table: tableName,
          column: columnName,
          nullable: false,
        }),
      },
      {
        description: `verify column "${columnName}" has no default after temporary default removal`,
        sql: columnHasNoDefaultCheck({ schema, table: tableName, column: columnName }),
      },
    ],
  };
}
