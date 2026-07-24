import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { indexExistsAst } from '../../../contract-free/checks';
import { postgresError } from '../../errors';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
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
  /**
   * Partial-index predicate (WHERE body, without the keyword). Inserted
   * verbatim, never quoted or escaped — the same opaque-SQL stance as RLS
   * policy predicates.
   */
  readonly where?: string;
  readonly unique?: boolean;
}

/**
 * The element list between the parens of CREATE INDEX: either a column
 * tuple (each identifier quoted) or one opaque expression string covering
 * the entire list, inserted verbatim.
 */
export type CreateIndexElements =
  | { readonly columns: readonly string[] }
  | { readonly expression: string };

function renderIndexOptionValue(key: string, value: unknown): string {
  if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  throw postgresError(
    'CONTRACT.INDEX_INVALID',
    `Index option "${key}" must be a string, finite number, or boolean; got ${typeof value}`,
    { meta: { key, valueType: typeof value } },
  );
}

function renderIndexOptions(options: Record<string, unknown>): string {
  return Object.entries(options)
    .map(([key, value]) => `${quoteIdentifier(key)} = ${renderIndexOptionValue(key, value)}`)
    .join(', ');
}

export async function createIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  elements: CreateIndexElements,
  lowerer: ExecuteRequestLowerer,
  extras?: CreateIndexExtras,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const elementList =
    'columns' in elements ? elements.columns.map(quoteIdentifier).join(', ') : elements.expression;
  const unique = extras?.unique === true ? 'UNIQUE ' : '';
  const using = extras?.type ? ` USING ${quoteIdentifier(extras.type)}` : '';
  const options = extras?.options;
  const withClause =
    options && Object.keys(options).length > 0 ? ` WITH (${renderIndexOptions(options)})` : '';
  const whereClause = extras?.where !== undefined ? ` WHERE (${extras.where})` : '';
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
        `CREATE ${unique}INDEX ${quoteIdentifier(indexName)} ON ${qualified}${using} (${elementList})${withClause}${whereClause}`,
      ),
    ],
    postcheck: [step(`verify index "${indexName}" exists`, present.sql, present.params)],
  };
}

/**
 * `ALTER INDEX … RENAME TO`. `widening` for the same typology reason as the
 * RLS policy rename: a rename is neither additive creation nor destructive,
 * and the class vocabulary has no neutral middle class — it is NOT that a
 * rename widens anything.
 */
export async function renameIndex(
  schemaName: string,
  tableName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const fromChecks = indexExistsAst(schemaName, fromName);
  const toChecks = indexExistsAst(schemaName, toName);
  const fromPresent = await lowerer.lowerToExecuteRequest(fromChecks.indexPresent());
  const toAbsent = await lowerer.lowerToExecuteRequest(toChecks.indexAbsent());
  const toPresent = await lowerer.lowerToExecuteRequest(toChecks.indexPresent());
  return {
    id: `index.${schemaName}.${tableName}.${fromName}.rename`,
    label: `Rename index "${fromName}" to "${toName}" on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('index', toName, schemaName, tableName),
    precheck: [
      step(`ensure index "${fromName}" exists`, fromPresent.sql, fromPresent.params),
      step(`ensure index "${toName}" does not exist`, toAbsent.sql, toAbsent.params),
    ],
    execute: [
      step(
        `rename index "${fromName}" to "${toName}"`,
        `ALTER INDEX ${qualifyTableName(schemaName, fromName)} RENAME TO ${quoteIdentifier(toName)}`,
      ),
    ],
    postcheck: [step(`verify index "${toName}" exists`, toPresent.sql, toPresent.params)],
  };
}

export async function dropIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { present, absent } = await indexExistsSteps(lowerer, schemaName, indexName);
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index "${indexName}"`,
    operationClass: 'destructive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [step(`ensure index "${indexName}" exists`, present.sql, present.params)],
    execute: [
      step(`drop index "${indexName}"`, `DROP INDEX ${qualifyTableName(schemaName, indexName)}`),
    ],
    postcheck: [step(`verify index "${indexName}" does not exist`, absent.sql, absent.params)],
  };
}
