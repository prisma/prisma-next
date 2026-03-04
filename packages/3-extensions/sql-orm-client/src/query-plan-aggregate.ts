import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AggregateExpr,
  BoundWhereExpr,
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
import { buildOrmQueryPlan } from './query-plan-meta';
import type { AggregateSelector } from './types';
import { combineWhereFilters } from './where-utils';

function toAggregateExpr(tableName: string, selector: AggregateSelector<unknown>): AggregateExpr {
  if (selector.fn === 'count') {
    return createAggregateExpr('count');
  }

  if (!selector.column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  return createAggregateExpr(selector.fn, createColumnRef(tableName, selector.column));
}

function validateGroupedComparable(
  value: Expression | ParamRef | LiteralExpr | ListLiteralExpr,
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

  return value;
}

function validateGroupedMetricExpr(expr: Expression): AggregateExpr {
  if (expr.kind !== 'aggregate') {
    throw new Error('groupBy().having() only supports aggregate metric expressions');
  }

  return expr;
}

function validateGroupedHavingExpr(expr: WhereExpr): WhereExpr {
  if (expr.kind === 'and' || expr.kind === 'or') {
    return {
      ...expr,
      exprs: expr.exprs.map((child) => validateGroupedHavingExpr(child)),
    };
  }

  if (expr.kind === 'exists') {
    throw new Error(`Unsupported grouped having expression kind "${expr.kind}"`);
  }

  if (expr.kind === 'nullCheck') {
    return {
      ...expr,
      expr: validateGroupedMetricExpr(expr.expr),
    };
  }

  return {
    ...expr,
    left: validateGroupedMetricExpr(expr.left),
    right: validateGroupedComparable(expr.right),
  };
}

export function compileAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
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
  const where = combineWhereFilters(filters);
  if (where) {
    builder.where(where.expr);
  }

  return buildOrmQueryPlan(
    contract,
    builder.build(),
    where?.params ?? [],
    where?.paramDescriptors ?? [],
  );
}

export function compileGroupedAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
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
    ...groupByColumns.map((column) =>
      createProjectionItem(column, createColumnRef(tableName, column)),
    ),
    ...entries.map(([alias, selector]) =>
      createProjectionItem(alias, toAggregateExpr(tableName, selector)),
    ),
  ];

  const builder = createSelectAstBuilder(createTableSource(tableName))
    .project(projection)
    .groupBy(groupByColumns.map((column) => createColumnRef(tableName, column)));
  const where = combineWhereFilters(filters);
  if (where) {
    builder.where(where.expr);
  }

  if (havingExpr) {
    builder.having(validateGroupedHavingExpr(havingExpr));
  }

  return buildOrmQueryPlan(
    contract,
    builder.build(),
    where?.params ?? [],
    where?.paramDescriptors ?? [],
  );
}
