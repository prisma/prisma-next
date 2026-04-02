import {
  type Adapter,
  type AdapterProfile,
  type AggregateExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyQueryAst,
  type BinaryExpr,
  type CastExpr,
  type CodecParamsDescriptor,
  type CodecRegistry,
  type ColumnRef,
  createCodecRegistry,
  type DeleteAst,
  type InsertAst,
  type InsertValue,
  type JoinAst,
  type JoinOnExpr,
  type JsonArrayAggExpr,
  type JsonObjectExpr,
  type ListExpression,
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

interface RenderCtx {
  readonly contract?: PostgresContract;
  readonly pim?: ParamIndexMap;
  readonly codecs: CodecRegistry;
}

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
    returning: true,
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

    const ctx: RenderCtx = {
      contract: context.contract,
      pim: paramIndexMap,
      codecs: this.codecRegistry,
    };

    let sql: string;

    const node = ast;
    switch (node.kind) {
      case 'select':
        sql = renderSelect(node, ctx);
        break;
      case 'insert':
        sql = renderInsert(node, ctx);
        break;
      case 'update':
        sql = renderUpdate(node, ctx);
        break;
      case 'delete':
        sql = renderDelete(node, ctx);
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

function renderSelect(ast: SelectAst, ctx: RenderCtx): string {
  const selectClause = `SELECT ${renderDistinctPrefix(ast.distinct, ast.distinctOn, ctx)}${renderProjection(
    ast.projection,
    ctx,
  )}`;
  const fromClause = `FROM ${renderSource(ast.from, ctx)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, ctx)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderWhere(ast.where, ctx)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, ctx)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderWhere(ast.having, ctx)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr, ctx);
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

function renderProjection(projection: ReadonlyArray<ProjectionItem>, ctx: RenderCtx): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, ctx)} AS ${alias}`;
    })
    .join(', ');
}

function renderDistinctPrefix(
  distinct: true | undefined,
  distinctOn: ReadonlyArray<AnyExpression> | undefined,
  ctx: RenderCtx,
): string {
  if (distinctOn && distinctOn.length > 0) {
    const rendered = distinctOn.map((expr) => renderExpr(expr, ctx)).join(', ');
    return `DISTINCT ON (${rendered}) `;
  }
  if (distinct) {
    return 'DISTINCT ';
  }
  return '';
}

function renderSource(source: AnyFromSource, ctx: RenderCtx): string {
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
      return `(${renderSelect(node.query, ctx)}) AS ${quoteIdentifier(node.alias)}`;
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

function renderSubqueryExpr(expr: SubqueryExpr, ctx: RenderCtx): string {
  assertScalarSubquery(expr.query);
  return `(${renderSelect(expr.query, ctx)})`;
}

function renderWhere(expr: AnyExpression, ctx: RenderCtx): string {
  return renderExpr(expr, ctx);
}

function renderNullCheck(expr: NullCheckExpr, ctx: RenderCtx): string {
  const rendered = renderExpr(expr.expr, ctx);
  const renderedExpr =
    expr.expr.kind === 'operation' || expr.expr.kind === 'subquery' ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function resolveNativeType(codecId: string, codecs: CodecRegistry): string {
  const codec = codecs.get(codecId);
  const nativeType = codec?.meta?.db?.sql?.postgres?.nativeType;
  if (!nativeType) {
    throw new Error(`Unknown codec ID for cast: ${codecId}`);
  }
  return nativeType;
}

function renderCast(expr: CastExpr, ctx: RenderCtx): string {
  const inner = renderExpr(expr.expr, ctx);
  const nativeType = resolveNativeType(expr.targetCodecId, ctx.codecs);
  return `(${inner})::${nativeType}`;
}

function renderBinary(expr: BinaryExpr, ctx: RenderCtx): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, ctx);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode, ctx);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
      right = renderParamRef(rightNode, ctx.pim);
      break;
    default:
      right = renderExpr(rightNode, ctx);
      break;
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
    add: '+',
    sub: '-',
    mul: '*',
    div: '/',
    mod: '%',
  };

  const arithmeticOps: ReadonlySet<string> = new Set(['add', 'sub', 'mul', 'div', 'mod']);
  const result = `${leftRendered} ${operatorMap[expr.op]} ${right}`;
  return arithmeticOps.has(expr.op) ? `(${result})` : result;
}

function renderListLiteral(expr: ListExpression, ctx: RenderCtx): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref') return renderParamRef(v, ctx.pim);
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v, ctx);
    })
    .join(', ');
  return `(${values})`;
}

function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderAggregateExpr(expr: AggregateExpr, ctx: RenderCtx): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, ctx)})`;
}

function renderJsonObjectExpr(expr: JsonObjectExpr, ctx: RenderCtx): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      if (entry.value.kind === 'literal') {
        return [key, renderLiteral(entry.value)];
      }
      return [key, renderExpr(entry.value, ctx)];
    })
    .join(', ');
  return `json_build_object(${args})`;
}

function renderOrderByItems(items: ReadonlyArray<OrderByItem>, ctx: RenderCtx): string {
  return items.map((item) => `${renderExpr(item.expr, ctx)} ${item.dir.toUpperCase()}`).join(', ');
}

function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, ctx: RenderCtx): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}`
      : '';
  const aggregated = `json_agg(${renderExpr(expr.expr, ctx)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, json_build_array())`;
  }
  return aggregated;
}

function renderExpr(expr: AnyExpression, ctx: RenderCtx): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
    case 'operation':
      return renderOperation(node, ctx);
    case 'subquery':
      return renderSubqueryExpr(node, ctx);
    case 'aggregate':
      return renderAggregateExpr(node, ctx);
    case 'json-object':
      return renderJsonObjectExpr(node, ctx);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, ctx);
    case 'binary':
      return renderBinary(node, ctx);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' OR ')})`;
    case 'exists': {
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, ctx);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, ctx);
    case 'not':
      return `NOT (${renderExpr(node.expr, ctx)})`;
    case 'cast':
      return renderCast(node, ctx);
    case 'param-ref':
      return renderParamRef(node, ctx.pim);
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node, ctx);
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

function renderOperation(expr: OperationExpr, ctx: RenderCtx): string {
  const self = renderExpr(expr.self, ctx);
  const args = expr.args.map((arg) => {
    return renderExpr(arg, ctx);
  });

  let result = expr.lowering.template;
  result = result.replace(/\{\{self\}\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\{\\{arg${i}\\}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderJoin(join: JoinAst, ctx: RenderCtx): string {
  const joinType = join.joinType.toUpperCase();
  const lateral = join.lateral ? 'LATERAL ' : '';
  const source = renderSource(join.source, ctx);
  const onClause = renderJoinOn(join.on, ctx);
  return `${joinType} JOIN ${lateral}${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, ctx: RenderCtx): string {
  if (on.kind === 'eq-col-join-on') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, ctx);
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

function renderInsertValue(value: InsertValue | undefined, pim?: ParamIndexMap): string {
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

function renderInsert(ast: InsertAst, ctx: RenderCtx): string {
  const contract = ctx.contract;
  if (!contract) {
    throw new Error('INSERT requires a contract');
  }
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
        const renderedRow = columnOrder.map((column) => renderInsertValue(row[column], ctx.pim));
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
                return `${target} = ${renderParamRef(value, ctx.pim)}`;
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

function renderUpdate(ast: UpdateAst, ctx: RenderCtx): string {
  const table = quoteIdentifier(ast.table.name);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    switch (val.kind) {
      case 'param-ref':
        value = renderParamRef(val, ctx.pim);
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

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, ctx)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, ctx: RenderCtx): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, ctx)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
