import {
  type Adapter,
  type AdapterProfile,
  type AggregateExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyQueryAst,
  type AnyWhereExpr,
  type BinaryExpr,
  type CodecParamsDescriptor,
  type ColumnRef,
  createCodecRegistry,
  type DeleteAst,
  type InsertAst,
  type InsertValue,
  type JoinAst,
  type JoinOnExpr,
  type JsonArrayAggExpr,
  type JsonObjectExpr,
  type ListLiteralExpr,
  LiteralExpr,
  type LowererContext,
  type NullCheckExpr,
  type OperationExpr,
  type OrderByItem,
  type ParamRef,
  type ProjectionItem,
  type SelectAst,
  type SubqueryExpr,
  type UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from './codec-ids';
import { codecDefinitions } from './codecs';
import { escapeLiteral, quoteIdentifier } from './sql-utils';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const VECTOR_CODEC_ID = 'pg/vector@1' as const;

function getCodecParamCast(codecId: string | undefined): string | undefined {
  if (codecId === VECTOR_CODEC_ID) {
    return 'vector';
  }
  if (codecId === PG_JSON_CODEC_ID) {
    return 'json';
  }
  if (codecId === PG_JSONB_CODEC_ID) {
    return 'jsonb';
  }
  return undefined;
}

function renderTypedParam(index: number, codecId: string | undefined): string {
  const cast = getCodecParamCast(codecId);
  return cast ? `$${index}::${cast}` : `$${index}`;
}

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
  },
  sql: {
    enums: true,
  },
});

type AdapterCodec = (typeof codecDefinitions)[keyof typeof codecDefinitions]['codec'];
type ParameterizedCodec = AdapterCodec & {
  readonly paramsSchema: NonNullable<AdapterCodec['paramsSchema']>;
};

const parameterizedCodecs: ReadonlyArray<CodecParamsDescriptor> = Object.values(codecDefinitions)
  .map((definition) => definition.codec)
  .filter((codec): codec is ParameterizedCodec => codec.paramsSchema !== undefined)
  .map((codec) =>
    Object.freeze({
      codecId: codec.id,
      paramsSchema: codec.paramsSchema,
      ...ifDefined('init', codec.init),
    }),
  );

class PostgresAdapterImpl
  implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement>
{
  // These fields make the adapter instance structurally compatible with
  // RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();

  constructor(options?: PostgresAdapterOptions) {
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
    });
  }

  parameterizedCodecs(): ReadonlyArray<CodecParamsDescriptor> {
    return parameterizedCodecs;
  }

  lower(ast: AnyQueryAst, context: LowererContext<PostgresContract>) {
    let sql: string;
    const params = context.params ? [...context.params] : [];
    const node = ast;

    switch (node.kind) {
      case 'select':
        sql = renderSelect(node, context.contract);
        break;
      case 'insert':
        sql = renderInsert(node, context.contract);
        break;
      case 'update':
        sql = renderUpdate(node, context.contract);
        break;
      case 'delete':
        sql = renderDelete(node, context.contract);
        break;
      default: {
        const _exhaustive: never = node;
        throw new Error(`Unsupported AST node: ${(_exhaustive as AnyQueryAst).constructor.name}`);
      }
    }

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst, contract?: PostgresContract): string {
  const selectClause = `SELECT ${renderDistinctPrefix(
    ast.distinct,
    ast.distinctOn,
    contract,
  )}${renderProjection(ast.projection, contract)}`;
  const fromClause = `FROM ${renderSource(ast.from, contract)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderWhere(ast.where, contract)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, contract)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderWhere(ast.having, contract)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr, contract);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? `LIMIT ${ast.limit}` : '';
  const offsetClause = typeof ast.offset === 'number' ? `OFFSET ${ast.offset}` : '';

  const clauses = [
    selectClause,
    fromClause,
    joinsClause,
    whereClause,
    groupByClause,
    havingClause,
    orderClause,
    limitClause,
    offsetClause,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
  return clauses.trim();
}

function renderProjection(
  projection: ReadonlyArray<ProjectionItem>,
  contract?: PostgresContract,
): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, contract)} AS ${alias}`;
    })
    .join(', ');
}

function renderDistinctPrefix(
  distinct: true | undefined,
  distinctOn: ReadonlyArray<AnyExpression> | undefined,
  contract?: PostgresContract,
): string {
  if (distinctOn && distinctOn.length > 0) {
    const rendered = distinctOn.map((expr) => renderExpr(expr, contract)).join(', ');
    return `DISTINCT ON (${rendered}) `;
  }
  if (distinct) {
    return 'DISTINCT ';
  }
  return '';
}

function renderSource(source: AnyFromSource, contract?: PostgresContract): string {
  const node = source;
  switch (node.kind) {
    case 'table-source': {
      const table = quoteIdentifier(node.name);
      if (!node.alias) {
        return table;
      }
      return `${table} AS ${quoteIdentifier(node.alias)}`;
    }
    case 'derived-table-source':
      return `(${renderSelect(node.query, contract)}) AS ${quoteIdentifier(node.alias)}`;
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `Unsupported source node: ${(_exhaustive as AnyFromSource).constructor.name}`,
      );
    }
  }
}

function assertScalarSubquery(query: SelectAst): void {
  if (query.projection.length !== 1) {
    throw new Error('Subquery expressions must project exactly one column');
  }
}

function renderSubqueryExpr(expr: SubqueryExpr, contract?: PostgresContract): string {
  assertScalarSubquery(expr.query);
  return `(${renderSelect(expr.query, contract)})`;
}

function renderWhere(expr: AnyWhereExpr, contract?: PostgresContract): string {
  return expr.accept<string>({
    exists(expr) {
      const notKeyword = expr.notExists ? 'NOT ' : '';
      const subquery = renderSelect(expr.subquery, contract);
      return `${notKeyword}EXISTS (${subquery})`;
    },
    nullCheck(expr) {
      return renderNullCheck(expr, contract);
    },
    and(expr) {
      if (expr.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${expr.exprs.map((part) => renderWhere(part, contract)).join(' AND ')})`;
    },
    or(expr) {
      if (expr.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${expr.exprs.map((part) => renderWhere(part, contract)).join(' OR ')})`;
    },
    binary(expr) {
      return renderBinary(expr, contract);
    },
  });
}

function renderNullCheck(expr: NullCheckExpr, contract?: PostgresContract): string {
  const rendered = renderExpr(expr.expr, contract);
  const renderedExpr =
    expr.expr.kind === 'operation' || expr.expr.kind === 'subquery' ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, contract?: PostgresContract): string {
  if (expr.right.kind === 'list-literal' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, contract);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;
  const leftCol = leftExpr.kind === 'column-ref' ? (leftExpr as ColumnRef) : undefined;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list-literal':
      right = renderListLiteral(rightNode, contract, leftCol?.table, leftCol?.column);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
      right = renderParam(rightNode, contract, leftCol?.table, leftCol?.column);
      break;
    case 'subquery':
    case 'operation':
    case 'aggregate':
    case 'json-object':
    case 'json-array-agg':
      right = renderExpr(rightNode, contract);
      break;
    default: {
      const _exhaustive: never = rightNode;
      throw new Error(`Unsupported comparable kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }

  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderListLiteral(
  expr: ListLiteralExpr,
  contract?: PostgresContract,
  tableName?: string,
  columnName?: string,
): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) =>
      v.kind === 'param-ref' ? renderParam(v, contract, tableName, columnName) : renderLiteral(v),
    )
    .join(', ');
  return `(${values})`;
}

function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderAggregateExpr(expr: AggregateExpr, contract?: PostgresContract): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, contract)})`;
}

function renderJsonObjectExpr(expr: JsonObjectExpr, contract?: PostgresContract): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      if (entry.value.kind === 'literal') {
        return [key, renderLiteral(entry.value)];
      }
      return [key, renderExpr(entry.value, contract)];
    })
    .join(', ');
  return `json_build_object(${args})`;
}

function renderOrderByItems(
  items: ReadonlyArray<OrderByItem>,
  contract?: PostgresContract,
): string {
  return items
    .map((item) => `${renderExpr(item.expr, contract)} ${item.dir.toUpperCase()}`)
    .join(', ');
}

function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, contract?: PostgresContract): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, contract)}`
      : '';
  const aggregated = `json_agg(${renderExpr(expr.expr, contract)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, json_build_array())`;
  }
  return aggregated;
}

function renderExpr(expr: AnyExpression, contract?: PostgresContract): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'operation':
      return renderOperation(node, contract);
    case 'subquery':
      return renderSubqueryExpr(node, contract);
    case 'aggregate':
      return renderAggregateExpr(node, contract);
    case 'json-object':
      return renderJsonObjectExpr(node, contract);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, contract);
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `Unsupported expression node: ${(_exhaustive as AnyExpression).constructor.name}`,
      );
    }
  }
}

function renderParam(
  ref: ParamRef,
  contract?: PostgresContract,
  tableName?: string,
  columnName?: string,
): string {
  if (contract && tableName && columnName) {
    const tableMeta = contract.storage.tables[tableName];
    const columnMeta = tableMeta?.columns[columnName];
    return renderTypedParam(ref.index, columnMeta?.codecId);
  }
  return `$${ref.index}`;
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${escapeLiteral(expr.value)}'`;
  }
  if (typeof expr.value === 'number' || typeof expr.value === 'boolean') {
    return String(expr.value);
  }
  if (typeof expr.value === 'bigint') {
    return String(expr.value);
  }
  if (expr.value === null) {
    return 'NULL';
  }
  if (expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  if (Array.isArray(expr.value)) {
    return `ARRAY[${expr.value.map((v: unknown) => renderLiteral(new LiteralExpr(v))).join(', ')}]`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(expr: OperationExpr, contract?: PostgresContract): string {
  const self = renderExpr(expr.self, contract);
  const isVectorOperation = expr.forTypeId === VECTOR_CODEC_ID;
  const args = expr.args.map((arg) => {
    const node = arg;
    switch (node.kind) {
      case 'param-ref':
        return isVectorOperation ? `$${node.index}::vector` : renderParam(node, contract);
      case 'literal':
        return renderLiteral(node);
      case 'column-ref':
      case 'subquery':
      case 'operation':
      case 'aggregate':
      case 'json-object':
      case 'json-array-agg':
        return renderExpr(node, contract);
      default: {
        const _exhaustive: never = node;
        throw new Error(
          `Unsupported operation arg kind: ${(_exhaustive as { kind: string }).kind}`,
        );
      }
    }
  });

  let result = expr.lowering.template;
  result = result.replace(/\$\{self\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$\\{arg${i}\\}`, 'g'), args[i] ?? '');
  }

  if (expr.lowering.strategy === 'function') {
    return result;
  }

  return result;
}

function renderJoin(join: JoinAst, contract?: PostgresContract): string {
  const joinType = join.joinType.toUpperCase();
  const lateral = join.lateral ? 'LATERAL ' : '';
  const source = renderSource(join.source, contract);
  const onClause = renderJoinOn(join.on, contract);
  return `${joinType} JOIN ${lateral}${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract?: PostgresContract): string {
  if (on.kind === 'eq-col-join-on') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, contract);
}

function getInsertColumnOrder(
  rows: ReadonlyArray<Record<string, InsertValue>>,
  contract: PostgresContract,
  tableName: string,
): string[] {
  const orderedColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      orderedColumns.push(column);
    }
  }

  if (orderedColumns.length > 0) {
    return orderedColumns;
  }

  return Object.keys(contract.storage.tables[tableName]?.columns ?? {});
}

function renderInsertValue(
  value: InsertValue | undefined,
  contract: PostgresContract,
  tableName: string,
  columnName: string,
): string {
  if (!value || value.kind === 'default-value') {
    return 'DEFAULT';
  }

  switch (value.kind) {
    case 'param-ref': {
      const columnMeta = contract.storage.tables[tableName]?.columns[columnName];
      return renderTypedParam(value.index, columnMeta?.codecId);
    }
    case 'column-ref':
      return renderColumn(value);
    default: {
      const _exhaustive: never = value;
      throw new Error(
        `Unsupported value node in INSERT: ${(_exhaustive as { kind: string }).kind}`,
      );
    }
  }
}

function renderInsert(ast: InsertAst, contract: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const rows = ast.rows;
  if (rows.length === 0) {
    throw new Error('INSERT requires at least one row');
  }
  const hasExplicitValues = rows.some((row) => Object.keys(row).length > 0);
  const insertClause = (() => {
    if (!hasExplicitValues) {
      if (rows.length === 1) {
        return `INSERT INTO ${table} DEFAULT VALUES`;
      }

      const defaultColumns = getInsertColumnOrder(rows, contract, ast.table.name);
      if (defaultColumns.length === 0) {
        return `INSERT INTO ${table} VALUES ${rows.map(() => '()').join(', ')}`;
      }

      const quotedColumns = defaultColumns.map((column) => quoteIdentifier(column));
      const defaultRow = `(${defaultColumns.map(() => 'DEFAULT').join(', ')})`;
      return `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rows
        .map(() => defaultRow)
        .join(', ')}`;
    }

    const columnOrder = getInsertColumnOrder(rows, contract, ast.table.name);
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) =>
          renderInsertValue(row[column], contract, ast.table.name, column),
        );
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');

    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  })();
  const onConflictClause = ast.onConflict
    ? (() => {
        const conflictColumns = ast.onConflict.columns.map((col) => quoteIdentifier(col.column));
        if (conflictColumns.length === 0) {
          throw new Error('INSERT onConflict requires at least one conflict column');
        }

        const action = ast.onConflict.action;
        switch (action.kind) {
          case 'do-nothing':
            return ` ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
          case 'do-update-set': {
            const tableMeta = contract.storage.tables[ast.table.name];
            const updates = Object.entries(action.set).map(([colName, value]) => {
              const target = quoteIdentifier(colName);
              if (value.kind === 'param-ref') {
                const columnMeta = tableMeta?.columns[colName];
                return `${target} = ${renderTypedParam(value.index, columnMeta?.codecId)}`;
              }
              return `${target} = ${renderColumn(value)}`;
            });
            return ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
          }
          default: {
            const _exhaustive: never = action;
            throw new Error(
              `Unsupported onConflict action: ${(_exhaustive as { kind: string }).kind}`,
            );
          }
        }
      })()
    : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const tableMeta = contract.storage.tables[ast.table.name];
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    switch (val.kind) {
      case 'param-ref': {
        const columnMeta = tableMeta?.columns[col];
        value = renderTypedParam(val.index, columnMeta?.codecId);
        break;
      }
      case 'column-ref':
        value = renderColumn(val);
        break;
      default: {
        const _exhaustive: never = val;
        throw new Error(
          `Unsupported value node in UPDATE: ${(_exhaustive as { kind: string }).kind}`,
        );
      }
    }
    return `${column} = ${value}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract?: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
