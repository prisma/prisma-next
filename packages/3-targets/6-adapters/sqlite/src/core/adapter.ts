import {
  type Adapter,
  type AdapterProfile,
  type AggregateExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyQueryAst,
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
  type ListExpression,
  type LiteralExpr,
  type LowererContext,
  type NullCheckExpr,
  type OperationExpr,
  type OrderByItem,
  type ProjectionItem,
  type SelectAst,
  type SubqueryExpr,
  type UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { codecDefinitions } from './codecs';
import { escapeLiteral, quoteIdentifier } from './sql-utils';
import type { SqliteAdapterOptions, SqliteContract, SqliteLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    lateral: false,
    jsonAgg: true,
    returning: true,
    enums: false,
  },
});

class SqliteAdapterImpl implements Adapter<AnyQueryAst, SqliteContract, SqliteLoweredStatement> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  readonly profile: AdapterProfile<'sqlite'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();

  constructor(options?: SqliteAdapterOptions) {
    this.profile = Object.freeze({
      id: options?.profileId ?? 'sqlite/default@1',
      target: 'sqlite',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
      readMarkerStatement: () => ({
        sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta from prisma_contract_marker where id = ?',
        params: [1],
      }),
    });
  }

  parameterizedCodecs(): ReadonlyArray<CodecParamsDescriptor> {
    return [];
  }

  lower(ast: AnyQueryAst, context: LowererContext<SqliteContract>) {
    const collectedParamRefs = ast.collectParamRefs();
    const params: unknown[] = [];
    for (const ref of collectedParamRefs) {
      params.push(ref.value);
    }

    let sql: string;

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
        sql = renderDelete(node);
        break;
      default:
        throw new Error(`Unsupported AST node kind: ${(node as { kind: string }).kind}`);
    }

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst, contract?: SqliteContract): string {
  const distinctPrefix = ast.distinct ? 'DISTINCT ' : '';
  const selectClause = `SELECT ${distinctPrefix}${renderProjection(ast.projection, contract)}`;
  const fromClause = `FROM ${renderSource(ast.from, contract)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderExpr(ast.where, contract)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, contract)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderExpr(ast.having, contract)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => `${renderExpr(order.expr, contract)} ${order.dir.toUpperCase()}`)
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? `LIMIT ${ast.limit}` : '';
  const offsetClause = typeof ast.offset === 'number' ? `OFFSET ${ast.offset}` : '';

  return [
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
    .join(' ')
    .trim();
}

function renderProjection(
  projection: ReadonlyArray<ProjectionItem>,
  contract?: SqliteContract,
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

function renderSource(source: AnyFromSource, contract?: SqliteContract): string {
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
    default:
      throw new Error(`Unsupported source node kind: ${(node as { kind: string }).kind}`);
  }
}

function renderExpr(expr: AnyExpression, contract?: SqliteContract): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
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
    case 'binary':
      return renderBinary(node, contract);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract)).join(' OR ')})`;
    case 'exists': {
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, contract);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, contract);
    case 'not':
      return `NOT (${renderExpr(node.expr, contract)})`;
    case 'param-ref':
      return '?';
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node);
    default:
      throw new Error(`Unsupported expression node kind: ${(node as { kind: string }).kind}`);
  }
}

// `excluded` is a pseudo-table in ON CONFLICT DO UPDATE that references the
// row proposed for insertion. It is not quoted because it's a keyword.
function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
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
  if (expr.value === null || expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(expr: OperationExpr, contract?: SqliteContract): string {
  const self = renderExpr(expr.self, contract);
  const args = expr.args.map((arg) => renderExpr(arg, contract));

  let result = expr.lowering.template;
  result = result.replace(/\{\{self\}\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\{\\{arg${i}\\}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderSubqueryExpr(expr: SubqueryExpr, contract?: SqliteContract): string {
  if (expr.query.projection.length !== 1) {
    throw new Error('Subquery expressions must project exactly one column');
  }
  return `(${renderSelect(expr.query, contract)})`;
}

function renderNullCheck(expr: NullCheckExpr, contract?: SqliteContract): string {
  const rendered = renderExpr(expr.expr, contract);
  const renderedExpr =
    expr.expr.kind === 'operation' || expr.expr.kind === 'subquery' ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, contract?: SqliteContract): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
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

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
      right = '?';
      break;
    default:
      right = renderExpr(rightNode, contract);
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
    ilike: 'LIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderListLiteral(expr: ListExpression): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref') return '?';
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v);
    })
    .join(', ');
  return `(${values})`;
}

function renderAggregateExpr(expr: AggregateExpr, contract?: SqliteContract): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, contract)})`;
}

function renderJsonObjectExpr(expr: JsonObjectExpr, contract?: SqliteContract): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      if (entry.value.kind === 'literal') {
        return [key, renderLiteral(entry.value)];
      }
      return [key, renderExpr(entry.value, contract)];
    })
    .join(', ');
  return `json_object(${args})`;
}

function renderOrderByItems(items: ReadonlyArray<OrderByItem>, contract?: SqliteContract): string {
  return items
    .map((item) => `${renderExpr(item.expr, contract)} ${item.dir.toUpperCase()}`)
    .join(', ');
}

function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, contract?: SqliteContract): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, contract)}`
      : '';
  const aggregated = `json_group_array(${renderExpr(expr.expr, contract)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, '[]')`;
  }
  return aggregated;
}

function renderJoin(join: JoinAst, contract?: SqliteContract): string {
  const joinType = join.joinType.toUpperCase();
  const source = renderSource(join.source, contract);
  const onClause = renderJoinOn(join.on, contract);
  return `${joinType} JOIN ${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract?: SqliteContract): string {
  if (on.kind === 'eq-col-join-on') {
    return `${renderColumn(on.left)} = ${renderColumn(on.right)}`;
  }
  return renderExpr(on, contract);
}

// Collects the union of column names across all rows in insertion order.
// Multi-row inserts may have different keys per row (some rows omit columns
// that get DEFAULT). This builds a stable column list so every row renders
// with the same column positions.
function collectInsertColumns(
  rows: ReadonlyArray<Record<string, InsertValue>>,
  contract: SqliteContract,
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

function renderInsertValue(value: InsertValue | undefined): string {
  if (!value || value.kind === 'default-value') {
    throw new Error('SQLite does not support DEFAULT as a value in INSERT ... VALUES');
  }

  switch (value.kind) {
    case 'param-ref':
      return '?';
    case 'column-ref':
      return renderColumn(value);
    default:
      throw new Error(`Unsupported value node in INSERT: ${(value as { kind: string }).kind}`);
  }
}

function renderInsert(ast: InsertAst, contract: SqliteContract): string {
  const table = quoteIdentifier(ast.table.name);
  const rows = ast.rows;
  if (rows.length === 0) {
    throw new Error('INSERT requires at least one row');
  }
  const hasExplicitValues = rows.some((row) => Object.keys(row).length > 0);

  let insertClause: string;
  if (!hasExplicitValues) {
    insertClause = `INSERT INTO ${table} DEFAULT VALUES`;
  } else {
    const columnOrder = collectInsertColumns(rows, contract, ast.table.name);
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) => renderInsertValue(row[column]));
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');
    insertClause = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  }

  let onConflictClause = '';
  if (ast.onConflict) {
    const conflictColumns = ast.onConflict.columns.map((col) => quoteIdentifier(col.column));
    if (conflictColumns.length === 0) {
      throw new Error('INSERT onConflict requires at least one conflict column');
    }

    const action = ast.onConflict.action;
    switch (action.kind) {
      case 'do-nothing':
        onConflictClause = ` ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
        break;
      case 'do-update-set': {
        const updates = Object.entries(action.set).map(([colName, value]) => {
          const target = quoteIdentifier(colName);
          if (value.kind === 'param-ref') {
            return `${target} = ?`;
          }
          return `${target} = ${renderColumn(value)}`;
        });
        onConflictClause = ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
        break;
      }
      default:
        throw new Error(`Unsupported onConflict action: ${(action as { kind: string }).kind}`);
    }
  }

  const returningClause = renderReturning(ast.returning);

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: SqliteContract): string {
  const table = quoteIdentifier(ast.table.name);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    switch (val.kind) {
      case 'param-ref':
        value = '?';
        break;
      case 'column-ref':
        value = renderColumn(val);
        break;
      default:
        throw new Error(`Unsupported value node in UPDATE: ${(val as { kind: string }).kind}`);
    }
    return `${column} = ${value}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where, contract)}` : '';
  const returningClause = renderReturning(ast.returning);

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where)}` : '';
  const returningClause = renderReturning(ast.returning);

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

function renderReturning(returning: ReadonlyArray<ColumnRef> | undefined): string {
  if (!returning?.length) {
    return '';
  }
  return ` RETURNING ${returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`;
}

export function createSqliteAdapter(options?: SqliteAdapterOptions) {
  return Object.freeze(new SqliteAdapterImpl(options));
}
