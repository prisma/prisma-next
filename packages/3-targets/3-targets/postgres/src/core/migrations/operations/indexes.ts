import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName, toRegclassLiteral } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

export function createIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  columns: readonly string[],
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index "${indexName}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [
      step(
        `ensure index "${indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
      ),
    ],
    execute: [
      step(
        `create index "${indexName}"`,
        `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualified} (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
      ),
    ],
  };
}

export function dropIndex(schemaName: string, tableName: string, indexName: string): Op {
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index "${indexName}"`,
    operationClass: 'destructive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [
      step(
        `ensure index "${indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
      ),
    ],
    execute: [
      step(`drop index "${indexName}"`, `DROP INDEX ${qualifyTableName(schemaName, indexName)}`),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
      ),
    ],
  };
}
