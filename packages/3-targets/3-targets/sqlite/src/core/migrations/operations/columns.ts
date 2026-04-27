import { quoteIdentifier } from '@prisma-next/adapter-sqlite/control';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { buildAddColumnSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import { esc, type Op, step } from './shared';

export function addColumn(
  tableName: string,
  columnName: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance>,
): Op {
  return {
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} on ${tableName}`,
    summary: `Adds column ${columnName} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [
      step(
        `ensure column "${columnName}" is missing`,
        `SELECT COUNT(*) = 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
      ),
    ],
    execute: [
      step(
        `add column "${columnName}"`,
        buildAddColumnSql(tableName, columnName, column, codecHooks, storageTypes),
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" exists`,
        `SELECT COUNT(*) > 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
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
