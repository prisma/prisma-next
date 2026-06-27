import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { indexExistsAst } from '../../../contract-free/checks';
import type { PostgresEntityRef } from '../../entity-ref';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { type Op, step, targetDetails } from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function indexExistsSteps(
  lowerer: ExecuteRequestLowerer,
  schemaName: string,
  indexName: string,
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = indexExistsAst(schemaName, indexName);
  const present = await lowerer.lowerToExecuteRequest(checks.indexPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.indexAbsent());
  return { present, absent };
}

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

export async function createIndex(
  table: PostgresEntityRef,
  indexName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
  extras?: CreateIndexExtras,
): Promise<Op> {
  const schemaName = table.namespace.id;
  const tableName = table.id;
  const qualified = table.namespace.qualifyTable(table.id);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const using = extras?.type ? ` USING ${quoteIdentifier(extras.type)}` : '';
  const options = extras?.options;
  const withClause =
    options && Object.keys(options).length > 0 ? ` WITH (${renderIndexOptions(options)})` : '';
  const { present, absent } = await indexExistsSteps(lowerer, schemaName, indexName);
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index "${indexName}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [step(`ensure index "${indexName}" does not exist`, absent.sql, absent.params)],
    execute: [
      step(
        `create index "${indexName}"`,
        `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualified}${using} (${columnList})${withClause}`,
      ),
    ],
    postcheck: [step(`verify index "${indexName}" exists`, present.sql, present.params)],
  };
}

export async function dropIndex(
  table: PostgresEntityRef,
  indexName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = table.namespace.id;
  const tableName = table.id;
  const { present, absent } = await indexExistsSteps(lowerer, schemaName, indexName);
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index "${indexName}"`,
    operationClass: 'destructive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [step(`ensure index "${indexName}" exists`, present.sql, present.params)],
    execute: [
      step(`drop index "${indexName}"`, `DROP INDEX ${table.namespace.qualifyTable(indexName)}`),
    ],
    postcheck: [step(`verify index "${indexName}" does not exist`, absent.sql, absent.params)],
  };
}
