import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName, toRegclassLiteral } from '../planner-sql-checks';
import { type ColumnSpec, type Op, renderColumnDefinition, step, targetDetails } from './shared';

export function createTable(
  schemaName: string,
  tableName: string,
  columns: ReadonlyArray<ColumnSpec>,
  primaryKey?: { readonly columns: readonly string[] },
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnDefs = columns.map(renderColumnDefinition);
  const constraintDefs: string[] = [];
  if (primaryKey) {
    constraintDefs.push(`PRIMARY KEY (${primaryKey.columns.map(quoteIdentifier).join(', ')})`);
  }
  const allDefs = [...columnDefs, ...constraintDefs];
  const createSql = `CREATE TABLE ${qualified} (\n  ${allDefs.join(',\n  ')}\n)`;

  return {
    id: `table.${tableName}`,
    label: `Create table "${tableName}"`,
    summary: `Creates table "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [
      step(
        `ensure table "${tableName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      ),
    ],
    execute: [step(`create table "${tableName}"`, createSql)],
    postcheck: [
      step(
        `verify table "${tableName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      ),
    ],
  };
}

export function dropTable(schemaName: string, tableName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      ),
    ],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${qualified}`)],
    postcheck: [
      step(
        `verify table "${tableName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      ),
    ],
  };
}
