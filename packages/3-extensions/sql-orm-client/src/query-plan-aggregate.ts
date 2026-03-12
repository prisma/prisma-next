import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  ExistsExpr,
  type Expression,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { buildOrmQueryPlan } from './query-plan-meta';
import type { AggregateSelector } from './types';
import { combineWhereFilters } from './where-utils';

function toAggregateExpr(tableName: string, selector: AggregateSelector<unknown>): AggregateExpr {
  if (selector.fn === 'count') {
    return AggregateExpr.count();
  }

  if (!selector.column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  return new AggregateExpr(selector.fn, ColumnRef.of(tableName, selector.column));
}

function validateGroupedComparable(
  value: Expression | ParamRef | LiteralExpr | ListLiteralExpr,
): Expression | LiteralExpr | ListLiteralExpr {
  if (value instanceof ParamRef) {
    throw new Error('ParamRef is not supported in grouped having expressions');
  }

  if (value instanceof LiteralExpr) {
    return value;
  }

  if (value instanceof ListLiteralExpr) {
    if (value.values.some((entry) => entry instanceof ParamRef)) {
      throw new Error('ParamRef is not supported in grouped having expressions');
    }
    return value;
  }

  return value;
}

function validateGroupedMetricExpr(expr: Expression): AggregateExpr {
  if (!(expr instanceof AggregateExpr)) {
    throw new Error('groupBy().having() only supports aggregate metric expressions');
  }

  return expr;
}

function validateGroupedHavingExpr(expr: WhereExpr): WhereExpr {
  if (expr instanceof AndExpr) {
    return AndExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
  }

  if (expr instanceof OrExpr) {
    return OrExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
  }

  if (expr instanceof ExistsExpr) {
    throw new Error(`Unsupported grouped having expression kind "${expr.constructor.name}"`);
  }

  if (expr instanceof NullCheckExpr) {
    return new NullCheckExpr(validateGroupedMetricExpr(expr.expr), expr.isNull);
  }

  if (expr instanceof BinaryExpr) {
    return new BinaryExpr(
      expr.op,
      validateGroupedMetricExpr(expr.left),
      validateGroupedComparable(expr.right),
    );
  }

  throw new Error(`Unsupported grouped having expression node "${expr.constructor.name}"`);
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
    ProjectionItem.of(alias, toAggregateExpr(tableName, selector)),
  );
  let ast = SelectAst.from(TableSource.named(tableName)).withProject(project);
  const where = combineWhereFilters(filters);
  if (where) {
    ast = ast.withWhere(where.expr);
  }

  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
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
    ...groupByColumns.map((column) => ProjectionItem.of(column, ColumnRef.of(tableName, column))),
    ...entries.map(([alias, selector]) =>
      ProjectionItem.of(alias, toAggregateExpr(tableName, selector)),
    ),
  ];

  let ast = SelectAst.from(TableSource.named(tableName))
    .withProject(projection)
    .withGroupBy(groupByColumns.map((column) => ColumnRef.of(tableName, column)));
  const where = combineWhereFilters(filters);
  if (where) {
    ast = ast.withWhere(where.expr);
  }

  if (havingExpr) {
    ast = ast.withHaving(validateGroupedHavingExpr(havingExpr));
  }

  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
}
