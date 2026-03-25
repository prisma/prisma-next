import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  type AnySqlComparable,
  type AnyWhereExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  NullCheckExpr,
  OrExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { buildOrmQueryPlan, deriveParamsFromAst } from './query-plan-meta';
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

// ORM HAVING filters use literal binding (values inlined at plan-build time),
// not parameterized binding. ParamRef is rejected because the ORM's grouped
// collection API always produces literal comparisons for having() predicates.
function validateGroupedComparable(value: AnySqlComparable): AnySqlComparable {
  switch (value.kind) {
    case 'param-ref':
      throw new Error('ParamRef is not supported in grouped having expressions');
    case 'literal':
      return value;
    case 'list-literal':
      if (value.values.some((entry) => entry.kind === 'param-ref')) {
        throw new Error('ParamRef is not supported in grouped having expressions');
      }
      return value;
    case 'column-ref':
    case 'subquery':
    case 'operation':
    case 'aggregate':
    case 'json-object':
    case 'json-array-agg':
      return value;
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported comparable kind in grouped having: ${(value satisfies never as { kind: string }).kind}`,
      );
  }
}

function validateGroupedMetricExpr(expr: AnyExpression): AggregateExpr {
  if (expr.kind !== 'aggregate') {
    throw new Error('groupBy().having() only supports aggregate metric expressions');
  }

  return expr;
}

function validateGroupedHavingExpr(expr: AnyWhereExpr): AnyWhereExpr {
  return expr.accept<AnyWhereExpr>({
    and(expr) {
      return AndExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((child) => validateGroupedHavingExpr(child)));
    },
    exists(expr) {
      throw new Error(`Unsupported grouped having expression kind "${expr.constructor.name}"`);
    },
    nullCheck(expr) {
      return new NullCheckExpr(validateGroupedMetricExpr(expr.expr), expr.isNull);
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
  filters: readonly BoundWhereExpr[],
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
  const where = combineWhereFilters(filters);
  if (where) {
    ast = ast.withWhere(where.expr);
  }

  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileGroupedAggregate(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
  groupByColumns: readonly string[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
  havingExpr: AnyWhereExpr | undefined,
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
  const where = combineWhereFilters(filters);
  if (where) {
    ast = ast.withWhere(where.expr);
  }

  if (havingExpr) {
    ast = ast.withHaving(validateGroupedHavingExpr(havingExpr));
  }

  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}
