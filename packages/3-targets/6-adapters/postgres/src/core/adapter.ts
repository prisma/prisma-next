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

type ParamIndexMap = Map<ParamRef, number>;

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
    const collectedParamRefs = ast.collectParamRefs();
    const paramIndexMap: ParamIndexMap = new Map();
    const params: unknown[] = [];
    for (const ref of collectedParamRefs) {
      if (paramIndexMap.has(ref)) {
        continue;
      }
      paramIndexMap.set(ref, params.length + 1);
      params.push(ref.value);
    }

    let sql: string;
    const node = ast;

    switch (node.kind) {
      case 'select':
        sql = renderSelect(node, context.contract, paramIndexMap);
        break;
      case 'insert':
        sql = renderInsert(node, context.contract, paramIndexMap);
        break;
      case 'update':
        sql = renderUpdate(node, context.contract, paramIndexMap);
        break;
      case 'delete':
        sql = renderDelete(node, context.contract, paramIndexMap);
        break;
      // v8 ignore next 4
      default:
        throw new Error(
          `Unsupported AST node kind: ${(node satisfies never as { kind: string }).kind}`,
        );
    }

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const selectClause = `SELECT ${renderDistinctPrefix(ast.distinct, ast.distinctOn, contract, pim)}${renderProjection(
    ast.projection,
    contract,
    pim,
  )}`;
  const fromClause = `FROM ${renderSource(ast.from, contract, pim)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract, pim)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, contract, pim)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderWhere(ast.having, contract, pim)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr, contract, pim);
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
  pim?: ParamIndexMap,
): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, contract, pim)} AS ${alias}`;
    })
    .join(', ');
}

function renderDistinctPrefix(
  distinct: true | undefined,
  distinctOn: ReadonlyArray<AnyExpression> | undefined,
  contract?: PostgresContract,
  pim?: ParamIndexMap,
): string {
  if (distinctOn && distinctOn.length > 0) {
    const rendered = distinctOn.map((expr) => renderExpr(expr, contract, pim)).join(', ');
    return `DISTINCT ON (${rendered}) `;
  }
  if (distinct) {
    return 'DISTINCT ';
  }
  return '';
}

function renderSource(source: AnyFromSource, contract?: PostgresContract, pim?: ParamIndexMap): string {
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
      return `(${renderSelect(node.query, contract, pim)}) AS ${quoteIdentifier(node.alias)}`;
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported source node kind: ${(node satisfies never as { kind: string }).kind}`,
      );
  }
}

function assertScalarSubquery(query: SelectAst): void {
  if (query.projection.length !== 1) {
    throw new Error('Subquery expressions must project exactly one column');
  }
}

function renderSubqueryExpr(expr: SubqueryExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  assertScalarSubquery(expr.query);
  return `(${renderSelect(expr.query, contract, pim)})`;
}

function renderWhere(expr: AnyWhereExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  return expr.accept<string>({
    exists(expr) {
      const notKeyword = expr.notExists ? 'NOT ' : '';
      const subquery = renderSelect(expr.subquery, contract, pim);
      return `${notKeyword}EXISTS (${subquery})`;
    },
    nullCheck(expr) {
      return renderNullCheck(expr, contract, pim);
    },
    and(expr) {
      if (expr.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${expr.exprs.map((part) => renderWhere(part, contract, pim)).join(' AND ')})`;
    },
    or(expr) {
      if (expr.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${expr.exprs.map((part) => renderWhere(part, contract, pim)).join(' OR ')})`;
    },
    binary(expr) {
      return renderBinary(expr, contract, pim);
    },
  });
}

function renderNullCheck(expr: NullCheckExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const rendered = renderExpr(expr.expr, contract, pim);
  const renderedExpr =
    expr.expr.kind === 'operation' || expr.expr.kind === 'subquery' ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  if (expr.right.kind === 'list-literal' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, contract, pim);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list-literal':
      right = renderListLiteral(rightNode, pim);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
      right = renderParamRef(rightNode, pim);
      break;
    case 'subquery':
    case 'operation':
    case 'aggregate':
    case 'json-object':
    case 'json-array-agg':
      right = renderExpr(rightNode, contract, pim);
      break;
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported comparable kind: ${(rightNode satisfies never as { kind: string }).kind}`,
      );
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
  pim?: ParamIndexMap,
): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) =>
      v.kind === 'param-ref' ? renderParamRef(v, pim) : renderLiteral(v),
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

function renderAggregateExpr(expr: AggregateExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, contract, pim)})`;
}

function renderJsonObjectExpr(expr: JsonObjectExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      if (entry.value.kind === 'literal') {
        return [key, renderLiteral(entry.value)];
      }
      return [key, renderExpr(entry.value, contract, pim)];
    })
    .join(', ');
  return `json_build_object(${args})`;
}

function renderOrderByItems(
  items: ReadonlyArray<OrderByItem>,
  contract?: PostgresContract,
  pim?: ParamIndexMap,
): string {
  return items
    .map((item) => `${renderExpr(item.expr, contract, pim)} ${item.dir.toUpperCase()}`)
    .join(', ');
}

function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, contract, pim)}`
      : '';
  const aggregated = `json_agg(${renderExpr(expr.expr, contract, pim)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, json_build_array())`;
  }
  return aggregated;
}

function renderExpr(expr: AnyExpression, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'operation':
      return renderOperation(node, contract, pim);
    case 'subquery':
      return renderSubqueryExpr(node, contract, pim);
    case 'aggregate':
      return renderAggregateExpr(node, contract, pim);
    case 'json-object':
      return renderJsonObjectExpr(node, contract, pim);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, contract, pim);
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported expression node kind: ${(node satisfies never as { kind: string }).kind}`,
      );
  }
}

function renderParamRef(ref: ParamRef, pim?: ParamIndexMap): string {
  const index = pim?.get(ref);
  if (index === undefined) {
    throw new Error('ParamRef not found in index map');
  }
  return renderTypedParam(index, ref.codecId);
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

function renderOperation(expr: OperationExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const self = renderExpr(expr.self, contract, pim);
  const args = expr.args.map((arg) => {
    const node = arg;
    switch (node.kind) {
      case 'param-ref':
        return renderParamRef(node, pim);
      case 'literal':
        return renderLiteral(node);
      case 'column-ref':
      case 'subquery':
      case 'operation':
      case 'aggregate':
      case 'json-object':
      case 'json-array-agg':
        return renderExpr(node, contract, pim);
      // v8 ignore next 4
      default: {
        throw new Error(
          `Unsupported operation arg kind: ${(node satisfies never as { kind: string }).kind}`,
        );
      }
    }
  });

  let result = expr.lowering.template;
  result = result.replace(/\$\{self\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$\\{arg${i}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderJoin(join: JoinAst, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const joinType = join.joinType.toUpperCase();
  const lateral = join.lateral ? 'LATERAL ' : '';
  const source = renderSource(join.source, contract, pim);
  const onClause = renderJoinOn(join.on, contract, pim);
  return `${joinType} JOIN ${lateral}${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract?: PostgresContract, pim?: ParamIndexMap): string {
  if (on.kind === 'eq-col-join-on') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, contract, pim);
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
  pim?: ParamIndexMap,
): string {
  if (!value || value.kind === 'default-value') {
    return 'DEFAULT';
  }

  switch (value.kind) {
    case 'param-ref':
      return renderParamRef(value, pim);
    case 'column-ref':
      return renderColumn(value);
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported value node in INSERT: ${(value satisfies never as { kind: string }).kind}`,
      );
  }
}

function renderInsert(ast: InsertAst, contract: PostgresContract, pim?: ParamIndexMap): string {
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
          renderInsertValue(row[column], pim),
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
            const updates = Object.entries(action.set).map(([colName, value]) => {
              const target = quoteIdentifier(colName);
              if (value.kind === 'param-ref') {
                return `${target} = ${renderParamRef(value, pim)}`;
              }
              return `${target} = ${renderColumn(value)}`;
            });
            return ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
          }
          // v8 ignore next 4
          default:
            throw new Error(
              `Unsupported onConflict action: ${(action satisfies never as { kind: string }).kind}`,
            );
        }
      })()
    : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: PostgresContract, pim?: ParamIndexMap): string {
  const table = quoteIdentifier(ast.table.name);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    switch (val.kind) {
      case 'param-ref':
        value = renderParamRef(val, pim);
        break;
      case 'column-ref':
        value = renderColumn(val);
        break;
      // v8 ignore next 4
      default:
        throw new Error(
          `Unsupported value node in UPDATE: ${(val satisfies never as { kind: string }).kind}`,
        );
    }
    return `${column} = ${value}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract?: PostgresContract, pim?: ParamIndexMap): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
