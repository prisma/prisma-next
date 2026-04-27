import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import { toExpr } from '@prisma-next/sql-relational-core/expression';
import type {
  AggregateFunctions,
  AggregateOnlyFunctions,
  BooleanCodecType,
  BuiltinFunctions,
  CodecExpression,
  Expression,
  Functions,
} from '../expression';
import type { QueryContext, ScopeField, Subquery } from '../scope';
import { ExpressionImpl } from './expression-impl';

type CodecTypes = Record<string, { readonly input: unknown }>;
// Runtime-level ExprOrVal — accepts any codec, any nullability. Concrete codec
// typing lives on the public BuiltinFunctions surface in `../expression`.
type ExprOrVal<CodecId extends string = string, N extends boolean = boolean> = CodecExpression<
  CodecId,
  N,
  CodecTypes
>;

const BOOL_FIELD: BooleanCodecType = { codecId: 'pg/bool@1', nullable: false };

const resolve = toExpr;

/**
 * Resolves an Expression via `buildAst()`, or wraps a raw value as a
 * `LiteralExpr` — an SQL literal inlined into the query text, not a bound
 * parameter.
 *
 * Used for `and` / `or` operands. The usual operand is an `Expression<bool>`
 * (e.g. the result of `fns.eq`), which this function passes through by calling
 * `buildAst()`. The only time the raw-value branch fires is when the caller
 * writes `fns.and(true, x)` or similar — inlining `TRUE`/`FALSE` literals
 * lets the SQL planner statically simplify `TRUE AND x` to `x`, which it
 * cannot do for an opaque `ParamRef`.
 */
function toLiteralExpr(value: unknown): AstExpression {
  if (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  ) {
    return (value as { buildAst(): AstExpression }).buildAst();
  }
  return new LiteralExpr(value);
}

function boolExpr(astNode: AstExpression): ExpressionImpl<BooleanCodecType> {
  return new ExpressionImpl(astNode, BOOL_FIELD);
}

function eq(a: ExprOrVal, b: ExprOrVal): ExpressionImpl<BooleanCodecType> {
  if (b === null) return boolExpr(NullCheckExpr.isNull(resolve(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNull(resolve(b)));
  return boolExpr(new BinaryExpr('eq', resolve(a), resolve(b)));
}

function ne(a: ExprOrVal, b: ExprOrVal): ExpressionImpl<BooleanCodecType> {
  if (b === null) return boolExpr(NullCheckExpr.isNotNull(resolve(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNotNull(resolve(b)));
  return boolExpr(new BinaryExpr('neq', resolve(a), resolve(b)));
}

function comparison(a: ExprOrVal, b: ExprOrVal, op: BinaryOp): ExpressionImpl<BooleanCodecType> {
  return boolExpr(new BinaryExpr(op, resolve(a), resolve(b)));
}

function inOrNotIn(
  expr: Expression<ScopeField>,
  valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
  op: 'in' | 'notIn',
): ExpressionImpl<BooleanCodecType> {
  const left = expr.buildAst();
  const binaryFn = op === 'in' ? BinaryExpr.in : BinaryExpr.notIn;

  if (Array.isArray(valuesOrSubquery)) {
    const refs = valuesOrSubquery.map((v) => resolve(v));
    return boolExpr(binaryFn(left, ListExpression.of(refs)));
  }
  return boolExpr(binaryFn(left, SubqueryExpr.of(valuesOrSubquery.buildAst())));
}

function numericAgg(
  fn: 'sum' | 'avg' | 'min' | 'max',
  expr: Expression<ScopeField>,
): ExpressionImpl<{ codecId: string; nullable: true }> {
  return new ExpressionImpl(AggregateExpr[fn](expr.buildAst()), {
    codecId: expr.returnType.codecId,
    nullable: true as const,
  });
}

function createBuiltinFunctions() {
  return {
    eq: (a: ExprOrVal, b: ExprOrVal) => eq(a, b),
    ne: (a: ExprOrVal, b: ExprOrVal) => ne(a, b),
    gt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gt'),
    gte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gte'),
    lt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lt'),
    lte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lte'),
    and: (...exprs: ExprOrVal<'pg/bool@1', boolean>[]) =>
      boolExpr(AndExpr.of(exprs.map(toLiteralExpr))),
    or: (...exprs: ExprOrVal<'pg/bool@1', boolean>[]) =>
      boolExpr(OrExpr.of(exprs.map(toLiteralExpr))),
    exists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.exists(subquery.buildAst())),
    notExists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.notExists(subquery.buildAst())),
    in: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'in'),
    notIn: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'notIn'),
  } satisfies BuiltinFunctions<CodecTypes>;
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
): Functions<QC> {
  const builtins = createBuiltinFunctions();

  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      const builtin = (builtins as Record<string, unknown>)[prop];
      if (builtin) return builtin;

      const op = operations[prop];
      if (op) return op.impl;
      return undefined;
    },
  });
}

export function createAggregateFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
): AggregateFunctions<QC> {
  const baseFns = createFunctions<QC>(operations);
  const aggregates = createAggregateOnlyFunctions();

  return new Proxy({} as AggregateFunctions<QC>, {
    get(_target, prop: string) {
      const agg = (aggregates as Record<string, unknown>)[prop];
      if (agg) return agg;

      return (baseFns as Record<string, unknown>)[prop];
    },
  });
}
