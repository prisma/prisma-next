import { quoteIdentifier } from '../../sql-utils';
import { buildTargetDetails } from '../planner-target-details';
import { esc, type Op, type SqliteColumnSpec, step } from './shared';

export function addColumn(tableName: string, column: SqliteColumnSpec): Op {
  const parts = [
    `ALTER TABLE ${quoteIdentifier(tableName)}`,
    `ADD COLUMN ${quoteIdentifier(column.name)} ${column.typeSql}`,
    column.defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  const addSql = parts.join(' ');

  return {
    id: `column.${tableName}.${column.name}`,
    label: `Add column ${column.name} on ${tableName}`,
    summary: `Adds column ${column.name} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('column', column.name, tableName) },
    precheck: [
      step(
        `ensure column "${column.name}" is missing`,
        `SELECT COUNT(*) = 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(column.name)}'`,
      ),
    ],
    execute: [step(`add column "${column.name}"`, addSql)],
    postcheck: [
      step(
        `verify column "${column.name}" exists`,
        `SELECT COUNT(*) > 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(column.name)}'`,
      ),
    ],
  };
}

export function dropColumn(tableName: string, columnName: string): Op {
  return {
    id: `dropColumn.${tableName}.${columnName}`,
    label: `Drop column ${columnName} on ${tableName}`,
    summary: `Drops column ${columnName} on ${tableName} which is not in the contract`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [
      step(
        `ensure column "${columnName}" exists on "${tableName}"`,
        `SELECT COUNT(*) > 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
      ),
    ],
    execute: [
      step(
        `drop column "${columnName}" from "${tableName}"`,
        `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" is gone from "${tableName}"`,
        `SELECT COUNT(*) = 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
      ),
    ],
  };
}
