import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  columnDefaultAst,
  columnExistsAst,
  columnNullabilityAst,
} from '../../contract-free/checks';
import { quoteIdentifier } from '../sql-utils';
import { step } from './operations/shared';
import { buildAddColumnSql } from './planner-ddl-builders';
import { qualifyTableName } from './planner-sql-checks';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';

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

export async function buildAddNotNullColumnWithTemporaryDefaultOperation(options: {
  readonly schema: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: StorageColumn;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly temporaryDefault: string;
  readonly lowerer: ExecuteRequestLowerer;
}): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  const {
    schema,
    tableName,
    columnName,
    column,
    codecHooks,
    storageTypes,
    temporaryDefault,
    lowerer,
  } = options;
  const qualified = qualifyTableName(schema, tableName);

  const absent = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema, table: tableName, column: columnName }).columnAbsent(),
  );
  const present = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema, table: tableName, column: columnName }).columnPresent(),
  );
  const notNullable = await lowerer.lowerToExecuteRequest(
    columnNullabilityAst({ schema, table: tableName, column: columnName, nullable: false }),
  );
  const noDefault = await lowerer.lowerToExecuteRequest(
    columnDefaultAst({ schema, table: tableName, column: columnName }).noDefault(),
  );

  return {
    ...buildAddColumnOperationIdentity(schema, tableName, columnName),
    operationClass: 'additive',
    precheck: [step(`ensure column "${columnName}" is missing`, absent.sql, absent.params)],
    execute: [
      {
        description: `add column "${columnName}"`,
        sql: buildAddColumnSql(
          qualified,
          columnName,
          column,
          codecHooks,
          temporaryDefault,
          storageTypes,
        ),
      },
      {
        description: `drop temporary default from column "${columnName}"`,
        sql: `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} DROP DEFAULT`,
      },
    ],
    postcheck: [
      step(`verify column "${columnName}" exists`, present.sql, present.params),
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
      step(
        `verify column "${columnName}" has no default after temporary default removal`,
        noDefault.sql,
        noDefault.params,
      ),
    ],
  };
}
