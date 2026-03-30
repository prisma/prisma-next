import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  NotExpr,
  NullCheckExpr,
  OrExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { buildOrmQueryPlan, deriveParamsFromAst } from './query-plan-meta';
import type { AggregateSelector } from './types';
import { combineWhereExprs } from './where-utils';

function toAggregateExpr(tableName: string, selector: AggregateSelector<unknown>): AggregateExpr {
  if (selector.fn === 'count') {
    return AggregateExpr.count();
  }

  if (!selector.column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  return new AggregateExpr(selector.fn, ColumnRef.of(tableName, selector.column));
}

// ORM HAVING filters use literal binding (values inlined at plan-build time),
// not parameterized binding. ParamRef is rejected because the ORM's grouped
// collection API always produces literal comparisons for having() predicates.
function validateGroupedComparable(value: AnyExpression): AnyExpression {
  switch (value.kind) {
    case 'param-ref':
      throw new Error('ParamRef is not supported in grouped having expressions');
    case 'literal':
    case 'column-ref':
    case 'identifier-ref':
    case 'aggregate':
    case 'operation':
      return value;
    case 'list':
      if (value.values.some((entry) => entry.kind === 'param-ref')) {
        throw new Error('ParamRef is not supported in grouped having expressions');
      }
      return value;
    default:
      throw new Error(`Unsupported comparable kind in grouped having: "${value.kind}"`);
  }
}

function validateGroupedMetricExpr(expr: AnyExpression): AggregateExpr {
  if (expr.kind !== 'aggregate') {
    throw new Error('groupBy().having() only supports aggregate metric expressions');
  }

  return expr;
}

function rejectHavingExpr(expr: { kind: string }): never {
  throw new Error(`Unsupported grouped having expression kind "${expr.kind}"`);
}

function validateGroupedHavingExpr(expr: AnyExpression): AnyExpression {
  return expr.accept<AnyExpression>({
    columnRef: rejectHavingExpr,
    identifierRef: rejectHavingExpr,
    subquery: rejectHavingExpr,
    operation: rejectHavingExpr,
    aggregate: rejectHavingExpr,
    jsonObject: rejectHavingExpr,
    jsonArrayAgg: rejectHavingExpr,
    literal: rejectHavingExpr,
    param() {
      throw new Error('ParamRef is not supported in grouped having expressions');
    },
    list: rejectHavingExpr,
    and(expr) {
      return AndExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
    },
    exists(expr) {
      throw new Error(`Unsupported grouped having expression kind "${expr.kind}"`);
    },
    nullCheck(expr) {
      return new NullCheckExpr(validateGroupedMetricExpr(expr.expr), expr.isNull);
    },
    not(expr) {
      return new NotExpr(validateGroupedHavingExpr(expr.expr));
    },
    binary(expr) {
      return new BinaryExpr(
        expr.op,
        validateGroupedMetricExpr(expr.left),
        validateGroupedComparable(expr.right),
      );
    },
  });
}

export function compileAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly AnyExpression[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
): SqlQueryPlan<Record<string, unknown>> {
  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('aggregate() requires at least one aggregation selector');
  }

  const projection: ProjectionItem[] = entries.map(([alias, selector]) =>
    ProjectionItem.of(alias, toAggregateExpr(tableName, selector)),
  );
  let ast = SelectAst.from(TableSource.named(tableName)).withProjection(projection);
  const where = combineWhereExprs(filters);
  if (where) {
    ast = ast.withWhere(where);
  }

  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileGroupedAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly AnyExpression[],
  groupByColumns: readonly string[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
  havingExpr: AnyExpression | undefined,
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
    .withProjection(projection)
    .withGroupBy(groupByColumns.map((column) => ColumnRef.of(tableName, column)));
  const where = combineWhereExprs(filters);
  if (where) {
    ast = ast.withWhere(where);
  }

  if (havingExpr) {
    ast = ast.withHaving(validateGroupedHavingExpr(havingExpr));
  }

  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}
