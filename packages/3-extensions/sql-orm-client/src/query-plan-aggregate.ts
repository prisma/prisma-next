import type {
  AggregateExpr,
  Expression,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAggregateExpr,
  createColumnRef,
  createProjectionItem,
  createSelectAstBuilder,
  createTableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { buildOrmQueryPlan } from './query-plan-meta';
import type { AggregateSelector } from './types';
import { combineWhereFilters } from './where-utils';

export const GROUPED_HAVING_TABLE = '__orm_having';

export function compileHavingMetricColumn(
  fn: 'sum' | 'avg' | 'min' | 'max',
  column: string,
): string {
  return `${fn}:${column}`;
}

function resolveTableColumns(contract: SqlContract<SqlStorage>, tableName: string): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

function toAggregateExpr(
  tableName: string,
  selector: AggregateSelector<unknown>,
): AggregateExpr {
  if (selector.fn === 'count') {
    return createAggregateExpr('count');
  }

  if (!selector.column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  return createAggregateExpr(selector.fn, createColumnRef(tableName, selector.column));
}

function createGroupedMetricExpr(
  tableName: string,
  metric: string,
): AggregateExpr {
  if (metric === 'count') {
    // count(*) semantics are represented by aggregate without target expr.
    return createAggregateExpr('count');
  }

  const [fn, column] = metric.split(':', 2);
  if (!column) {
    throw new Error(`Invalid grouped having metric "${metric}"`);
  }
  if (fn !== 'sum' && fn !== 'avg' && fn !== 'min' && fn !== 'max') {
    throw new Error(`Unsupported grouped having metric "${metric}"`);
  }

  return createAggregateExpr(fn, createColumnRef(tableName, column));
}

function rewriteGroupedMetricExpr(
  expr: Expression,
  tableName: string,
  fallbackColumn: string,
): Expression {
  if (expr.kind === 'col' && expr.table === GROUPED_HAVING_TABLE) {
    return createGroupedMetricExpr(tableName, expr.column);
  }

  if (expr.kind === 'operation') {
    return {
      ...expr,
      self: rewriteGroupedMetricExpr(expr.self, tableName, fallbackColumn),
      args: expr.args.map((arg) => {
        if (arg.kind === 'literal' || arg.kind === 'param') {
          return arg;
        }
        return rewriteGroupedMetricExpr(arg, tableName, fallbackColumn);
      }),
    };
  }

  if (expr.kind === 'subquery') {
    return expr;
  }

  if (expr.kind === 'aggregate') {
    if (!expr.expr) {
      return expr;
    }
    return {
      ...expr,
      expr: rewriteGroupedMetricExpr(expr.expr, tableName, fallbackColumn),
    };
  }

  if (expr.kind === 'jsonArrayAgg') {
    return {
      ...expr,
      expr: rewriteGroupedMetricExpr(expr.expr, tableName, fallbackColumn),
      ...(expr.orderBy
        ? {
            orderBy: expr.orderBy.map((order) => ({
              ...order,
              expr: rewriteGroupedMetricExpr(order.expr, tableName, fallbackColumn),
            })),
          }
        : {}),
    };
  }

  if (expr.kind === 'jsonObject') {
    return {
      ...expr,
      entries: expr.entries.map((entry) => ({
        ...entry,
        value:
          entry.value.kind === 'literal'
              ? entry.value
              : rewriteGroupedMetricExpr(entry.value, tableName, fallbackColumn),
      })),
    };
  }

  return expr;
}

function rewriteGroupedComparable(
  value: Expression | ParamRef | LiteralExpr | ListLiteralExpr,
  tableName: string,
  fallbackColumn: string,
): Expression | LiteralExpr | ListLiteralExpr {
  if (value.kind === 'param') {
    throw new Error('ParamRef is not supported in grouped having expressions');
  }

  if (value.kind === 'literal') {
    return value;
  }

  if (value.kind === 'listLiteral') {
    if (value.values.some((entry) => entry.kind === 'param')) {
      throw new Error('ParamRef is not supported in grouped having expressions');
    }
    return value;
  }

  return rewriteGroupedMetricExpr(value, tableName, fallbackColumn);
}

function rewriteGroupedHavingExpr(
  expr: WhereExpr,
  tableName: string,
  fallbackColumn: string,
): WhereExpr {
  if (expr.kind === 'and' || expr.kind === 'or') {
    return {
      ...expr,
      exprs: expr.exprs.map((child) => rewriteGroupedHavingExpr(child, tableName, fallbackColumn)),
    };
  }

  if (expr.kind === 'exists') {
    throw new Error(`Unsupported grouped having expression kind "${expr.kind}"`);
  }

  if (expr.kind === 'nullCheck') {
    if (expr.expr.kind !== 'col' || expr.expr.table !== GROUPED_HAVING_TABLE) {
      throw new Error('groupBy().having() only supports aggregate metric expressions');
    }

    return {
      ...expr,
      expr: createGroupedMetricExpr(tableName, expr.expr.column),
    };
  }

  if (expr.left.kind !== 'col' || expr.left.table !== GROUPED_HAVING_TABLE) {
    throw new Error('groupBy().having() only supports aggregate metric expressions');
  }

  return {
    ...expr,
    left: createGroupedMetricExpr(tableName, expr.left.column),
    right: rewriteGroupedComparable(expr.right, tableName, fallbackColumn),
  };
}

export function compileAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly WhereExpr[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
): SqlQueryPlan<Record<string, unknown>> {
  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('aggregate() requires at least one aggregation selector');
  }

  const project: ProjectionItem[] = entries.map(([alias, selector]) =>
    createProjectionItem(alias, toAggregateExpr(tableName, selector)),
  );
  const builder = createSelectAstBuilder(createTableSource(tableName)).project(project);
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    builder.where(whereExpr);
  }

  return buildOrmQueryPlan(contract, builder.build(), []);
}

export function compileGroupedAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly WhereExpr[],
  groupByColumns: readonly string[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
  havingExpr: WhereExpr | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  if (groupByColumns.length === 0) {
    throw new Error('groupBy() requires at least one field');
  }

  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('groupBy().aggregate() requires at least one aggregation selector');
  }

  const projection: ProjectionItem[] = [
    ...groupByColumns.map((column) => createProjectionItem(column, createColumnRef(tableName, column))),
    ...entries.map(([alias, selector]) => createProjectionItem(alias, toAggregateExpr(tableName, selector))),
  ];

  const builder = createSelectAstBuilder(createTableSource(tableName))
    .project(projection)
    .groupBy(groupByColumns.map((column) => createColumnRef(tableName, column)));
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    builder.where(whereExpr);
  }

  const fallbackColumn = groupByColumns[0] ?? resolveTableColumns(contract, tableName)[0] ?? 'id';
  if (havingExpr) {
    builder.having(rewriteGroupedHavingExpr(havingExpr, tableName, fallbackColumn));
  }

  return buildOrmQueryPlan(contract, builder.build(), []);
}
