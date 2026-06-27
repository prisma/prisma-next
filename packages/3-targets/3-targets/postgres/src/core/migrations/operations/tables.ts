import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { tableExistsAst } from '../../../contract-free/checks';
import type { PostgresEntityRef } from '../../entity-ref';
import { type Op, step, targetDetails } from './shared';

export async function dropTable(
  table: PostgresEntityRef,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = table.namespace.id;
  const tableName = table.id;
  const qualified = table.namespace.qualifyTable(table.id);
  const checks = tableExistsAst(schemaName, tableName);
  const present = await lowerer.lowerToExecuteRequest(checks.tablePresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.tableAbsent());
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [step(`ensure table "${tableName}" exists`, present.sql, present.params)],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${qualified}`)],
    postcheck: [step(`verify table "${tableName}" does not exist`, absent.sql, absent.params)],
  };
}
