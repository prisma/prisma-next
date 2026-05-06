import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { qualifyTableName, toRegclassLiteral } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

export interface CreateIndexExtras {
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

function renderIndexOptionValue(key: string, value: unknown): string {
  if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  throw new Error(
    `Index option "${key}" must be a string, finite number, or boolean; got ${typeof value}`,
  );
}

function renderIndexOptions(options: Record<string, unknown>): string {
  return Object.entries(options)
    .map(([key, value]) => `${quoteIdentifier(key)} = ${renderIndexOptionValue(key, value)}`)
    .join(', ');
}

export function createIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  columns: readonly string[],
  extras?: CreateIndexExtras,
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const using = extras?.type ? ` USING ${quoteIdentifier(extras.type)}` : '';
  const optionsEntries = extras?.options ? Object.entries(extras.options) : [];
  const withClause =
    optionsEntries.length > 0 ? ` WITH (${renderIndexOptions(extras!.options!)})` : '';
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
        `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualified}${using} (${columnList})${withClause}`,
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
