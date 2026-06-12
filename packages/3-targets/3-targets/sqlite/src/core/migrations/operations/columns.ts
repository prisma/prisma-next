import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { buildTargetDetails } from '../planner-target-details';
import { type Op, type SqliteColumnSpec, step } from './shared';

export function addColumnExecuteSql(tableName: string, column: SqliteColumnSpec): string {
  const parts = [
    `ALTER TABLE ${quoteIdentifier(tableName)}`,
    `ADD COLUMN ${quoteIdentifier(column.name)} ${column.typeSql}`,
    column.defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

export function dropColumnExecuteSql(tableName: string, columnName: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`;
}

/**
 * Legacy raw-string copy for the authored-migration facade
 * (`@prisma-next/sqlite/migration`). The planner path uses
 * `AddColumnCall.toOp(lowerer)`, which binds the pragma_table_info checks as
 * typed, parameterized ASTs. Converting this sync, lowerer-less factory is
 * deferred to D3 of the typed-migration-verification-queries slice.
 */
export function addColumn(tableName: string, column: SqliteColumnSpec): Op {
  const addSql = addColumnExecuteSql(tableName, column);

  return {
    id: `column.${tableName}.${column.name}`,
    label: `Add column ${column.name} on ${tableName}`,
    summary: `Adds column ${column.name} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('column', column.name, tableName) },
    precheck: [
      step(
        `ensure column "${column.name}" is missing`,
        `SELECT COUNT(*) = 0 FROM pragma_table_info('${escapeLiteral(tableName)}') WHERE name = '${escapeLiteral(column.name)}'`,
      ),
    ],
    execute: [step(`add column "${column.name}"`, addSql)],
    postcheck: [
      step(
        `verify column "${column.name}" exists`,
        `SELECT COUNT(*) > 0 FROM pragma_table_info('${escapeLiteral(tableName)}') WHERE name = '${escapeLiteral(column.name)}'`,
      ),
    ],
  };
}

/**
 * Legacy raw-string copy for the authored-migration facade
 * (`@prisma-next/sqlite/migration`). The planner path uses
 * `DropColumnCall.toOp(lowerer)`, which binds the pragma_table_info checks as
 * typed, parameterized ASTs. Converting this sync, lowerer-less factory is
 * deferred to D3 of the typed-migration-verification-queries slice.
 */
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
        `SELECT COUNT(*) > 0 FROM pragma_table_info('${escapeLiteral(tableName)}') WHERE name = '${escapeLiteral(columnName)}'`,
      ),
    ],
    execute: [
      step(
        `drop column "${columnName}" from "${tableName}"`,
        dropColumnExecuteSql(tableName, columnName),
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" is gone from "${tableName}"`,
        `SELECT COUNT(*) = 0 FROM pragma_table_info('${escapeLiteral(tableName)}') WHERE name = '${escapeLiteral(columnName)}'`,
      ),
    ],
  };
}
