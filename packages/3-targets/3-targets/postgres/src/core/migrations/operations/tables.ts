import type { Lowerer } from '@prisma-next/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { PostgresCreateTable } from '../../ddl/nodes';
import { qualifyTableName, toRegclassLiteral } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

/**
 * Assemble a `CREATE TABLE` migration op from a lowered `PostgresCreateTable`
 * node. This is the single rendering path for both the planner-produced
 * `CreateTableCall.toOp(lowerer)` and the `PostgresMigration.createTable(...)`
 * instance method.
 */
export function buildCreateTableOp(node: PostgresCreateTable, lowerer: Lowerer): Op {
  const { sql } = lowerer.lower(node, { contract: {} });
  const schemaName = node.schema ?? UNBOUND_NAMESPACE_ID;
  const tableName = node.table;
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
    execute: [step(`create table "${tableName}"`, sql)],
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
