import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
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

function toAggregateProjection(
  contract: Contract<SqlStorage>,
  tableName: string,
  selector: AggregateSelector<unknown>,
): { expr: AggregateExpr; codecId: string | undefined } {
  if (selector.fn === 'count') {
    // count() returns a target-specific bigint; mapping isn't derivable here
    // without target coupling, so we leave codecId unstamped.
    return { expr: AggregateExpr.count(), codecId: undefined };
  }

  if (!selector.column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  const expr = new AggregateExpr(selector.fn, ColumnRef.of(tableName, selector.column));
  // min/max preserve the input column's type, so propagate the column codec.
  // sum widens (int4 → int8 in Postgres) and avg → numeric; both need
  // target+input-aware mapping that doesn't exist yet, so leave unstamped.
  if (selector.fn === 'min' || selector.fn === 'max') {
    const codecId = contract.storage.tables[tableName]?.columns[selector.column]?.codecId;
    return { expr, codecId };
  }
  return { expr, codecId: undefined };
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
  contract: Contract<SqlStorage>,
  tableName: string,
  filters: readonly AnyExpression[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
): SqlQueryPlan<Record<string, unknown>> {
  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('aggregate() requires at least one aggregation selector');
  }

  const projection: ProjectionItem[] = entries.map(([alias, selector]) => {
    const { expr, codecId } = toAggregateProjection(contract, tableName, selector);
    return ProjectionItem.of(alias, expr, codecId);
  });
  let ast = SelectAst.from(TableSource.named(tableName)).withProjection(projection);
  const where = combineWhereExprs(filters);
  if (where) {
    ast = ast.withWhere(where);
  }

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileGroupedAggregate(
  contract: Contract<SqlStorage>,
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

  const table = contract.storage.tables[tableName];
  const projection: ProjectionItem[] = [
    ...groupByColumns.map((column) =>
      ProjectionItem.of(column, ColumnRef.of(tableName, column), table?.columns[column]?.codecId),
    ),
    ...entries.map(([alias, selector]) => {
      const { expr, codecId } = toAggregateProjection(contract, tableName, selector);
      return ProjectionItem.of(alias, expr, codecId);
    }),
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

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}
