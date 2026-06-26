import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { FunctionColumnDefault } from '@prisma-next/sql-relational-core/ast';
import { col } from '@prisma-next/sql-relational-core/contract-free';
import {
  columnDefaultAst,
  columnExistsAst,
  columnNullabilityAst,
} from '../../contract-free/checks';
import * as contractFreeDdl from '../../contract-free/ddl';
import type { PostgresEntityRef } from '../entity-ref';
import { step } from './operations/shared';
import { buildColumnTypeSql } from './planner-ddl-builders';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';

export function buildAddColumnOperationIdentity(
  ref: PostgresEntityRef,
  columnName: string,
): Pick<
  SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  'id' | 'label' | 'summary' | 'target'
> {
  const tableName = ref.name;
  const schema = ref.namespace.id;
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
  readonly ref: PostgresEntityRef;
  readonly columnName: string;
  readonly column: StorageColumn;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly temporaryDefault: string;
  readonly lowerer: ExecuteRequestLowerer;
}): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  const { ref, columnName, column, codecHooks, storageTypes, temporaryDefault, lowerer } = options;
  const schema = ref.namespace.id;
  const tableName = ref.name;

  const ddlColumn = col(columnName, buildColumnTypeSql(column, codecHooks, storageTypes), {
    notNull: true,
    default: new FunctionColumnDefault(temporaryDefault),
  });
  const addColumn = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ref,
      actions: [contractFreeDdl.addColumnAction(ddlColumn)],
    }),
  );
  const dropTempDefault = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ref,
      actions: [contractFreeDdl.dropDefaultAction(columnName)],
    }),
  );

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
    ...buildAddColumnOperationIdentity(ref, columnName),
    operationClass: 'additive',
    precheck: [step(`ensure column "${columnName}" is missing`, absent.sql, absent.params)],
    execute: [
      {
        description: `add column "${columnName}"`,
        sql: addColumn.sql,
      },
      {
        description: `drop temporary default from column "${columnName}"`,
        sql: dropTempDefault.sql,
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
