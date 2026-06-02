import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import { AggregateExpr } from '@prisma-next/sql-relational-core/ast';
import type { RawCodecInferer } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type {
  AggregateFunctions,
  AggregateOnlyFunctions,
  Expression,
  Functions,
} from '../expression';
import type { QueryContext, ScopeField } from '../scope';
import { ExpressionImpl } from './expression-impl';

function numericAgg(
  fn: 'sum' | 'avg' | 'min' | 'max',
  expr: Expression<ScopeField>,
): ExpressionImpl<{ codecId: string; nullable: true }> {
  return new ExpressionImpl(AggregateExpr[fn](expr.buildAst()), {
    codecId: expr.returnType.codecId,
    nullable: true as const,
  });
}

function createAggregateOnlyFunctions() {
  return {
    count: (expr?: Expression<ScopeField>) => {
      const astExpr = expr ? expr.buildAst() : undefined;
      return new ExpressionImpl(AggregateExpr.count(astExpr), {
        codecId: 'pg/int8@1',
        nullable: false,
      });
    },
    sum: (expr: Expression<ScopeField>) => numericAgg('sum', expr),
    avg: (expr: Expression<ScopeField>) => numericAgg('avg', expr),
    min: (expr: Expression<ScopeField>) => numericAgg('min', expr),
    max: (expr: Expression<ScopeField>) => numericAgg('max', expr),
  } satisfies AggregateOnlyFunctions;
}

export function createFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
  rawCodecInferer: RawCodecInferer,
): Functions<QC> {
  // `raw` is the only builtin left on `Functions<QC>` after slice 3 of the
  // unify-query-operations project — every other former builtin
  // (`eq`/`neq`/`in`/etc.) now sources from the SQL-family registry via
  // `operations`. `raw` stays a hardcoded slot because its impl depends
  // on the adapter-supplied `RawCodecInferer`, which is not a static
  // family contribution.
  const raw = createRawSql(rawCodecInferer);
  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      if (prop === 'raw') return raw;
      return operations[prop]?.impl;
    },
  });
}

export function createAggregateFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
  rawCodecInferer: RawCodecInferer,
): AggregateFunctions<QC> {
  const baseFns = createFunctions<QC>(operations, rawCodecInferer);
  const aggregates = createAggregateOnlyFunctions();

  return new Proxy({} as AggregateFunctions<QC>, {
    get(_target, prop: string) {
      const agg = (aggregates as Record<string, unknown>)[prop];
      if (agg) return agg;

      return (baseFns as Record<string, unknown>)[prop];
    },
  });
}
