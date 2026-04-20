import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  CastExpr,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  OrExpr,
  ParamRef,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AggregateFunctions,
  AggregateOnlyFunctions,
  BooleanCodecType,
  BuiltinFunctions,
  Expression,
  ExpressionOrValue,
  Functions,
} from '../expression';
import type { QueryContext, ScopeField, Subquery } from '../scope';
import { ExpressionImpl } from './expression-impl';

type CodecTypes = Record<string, { readonly input: unknown }>;
type ExprOrVal<T extends ScopeField = ScopeField> = ExpressionOrValue<T, CodecTypes>;

const BOOL_FIELD: BooleanCodecType = { codecId: 'pg/bool@1', nullable: false };

function resolve(value: ExprOrVal): AstExpression {
  if (value instanceof ExpressionImpl) return value.buildAst();
  return ParamRef.of(value);
}

function resolveToAst(value: ExprOrVal): AstExpression {
  if (value instanceof ExpressionImpl) return value.buildAst();
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

function arithmetic<T extends ScopeField>(
  a: ExpressionOrValue<T, CodecTypes>,
  b: ExpressionOrValue<T, CodecTypes>,
  op: BinaryOp,
): ExpressionImpl<T> {
  const field = (
    a instanceof ExpressionImpl
      ? a.field
      : b instanceof ExpressionImpl
        ? b.field
        : { codecId: 'unknown', nullable: false }
  ) as T;
  return new ExpressionImpl(
    new BinaryExpr(op, resolve(a as ExprOrVal), resolve(b as ExprOrVal)),
    field,
  );
}

function numericAgg(
  fn: 'sum' | 'avg' | 'min' | 'max',
  expr: Expression<ScopeField>,
): ExpressionImpl<{ codecId: string; nullable: true }> {
  return new ExpressionImpl(AggregateExpr[fn](expr.buildAst()), {
    codecId: (expr as ExpressionImpl).field.codecId,
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
    and: (...exprs: ExprOrVal<BooleanCodecType>[]) => boolExpr(AndExpr.of(exprs.map(resolveToAst))),
    or: (...exprs: ExprOrVal<BooleanCodecType>[]) => boolExpr(OrExpr.of(exprs.map(resolveToAst))),
    add: <T extends ScopeField>(
      a: ExpressionOrValue<T, CodecTypes>,
      b: ExpressionOrValue<T, CodecTypes>,
    ) => arithmetic(a, b, 'add'),
    sub: <T extends ScopeField>(
      a: ExpressionOrValue<T, CodecTypes>,
      b: ExpressionOrValue<T, CodecTypes>,
    ) => arithmetic(a, b, 'sub'),
    mul: <T extends ScopeField>(
      a: ExpressionOrValue<T, CodecTypes>,
      b: ExpressionOrValue<T, CodecTypes>,
    ) => arithmetic(a, b, 'mul'),
    div: <T extends ScopeField>(
      a: ExpressionOrValue<T, CodecTypes>,
      b: ExpressionOrValue<T, CodecTypes>,
    ) => arithmetic(a, b, 'div'),
    mod: <T extends ScopeField>(
      a: ExpressionOrValue<T, CodecTypes>,
      b: ExpressionOrValue<T, CodecTypes>,
    ) => arithmetic(a, b, 'mod'),
    cast: <TargetCodecId extends string, Nullable extends boolean>(
      expr: Expression<ScopeField>,
      target: { codecId: TargetCodecId; nullable: Nullable },
    ) => {
      return new ExpressionImpl(CastExpr.of(expr.buildAst(), target.codecId), target);
    },
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

function createExtensionFunction(
  name: string,
  entry: SqlOperationEntry,
): (...args: ExprOrVal[]) => ExpressionImpl {
  return (...args: ExprOrVal[]) => {
    const resolvedArgs = args.map((arg, i) => {
      if (arg instanceof ExpressionImpl) return arg.buildAst();
      const codecId = entry.args[i]?.codecId;
      return ParamRef.of(arg, codecId ? { codecId } : undefined);
    });
    const self = resolvedArgs[0] as AstExpression;
    const restArgs = resolvedArgs.slice(1);

    return new ExpressionImpl(
      new OperationExpr({
        method: name,
        self,
        args: restArgs.length > 0 ? restArgs : undefined,
        returns: entry.returns,
        lowering: entry.lowering,
      }),
      entry.returns,
    );
  };
}

export function createFunctions<QC extends QueryContext>(
  queryOperationTypes: Readonly<Record<string, SqlOperationEntry>>,
): Functions<QC> {
  const builtins = createBuiltinFunctions();

  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      const builtin = (builtins as Record<string, unknown>)[prop];
      if (builtin) return builtin;

      const extOp = queryOperationTypes[prop];
      if (extOp) {
        return createExtensionFunction(prop, extOp);
      }
      return undefined;
    },
  });
}

export function createAggregateFunctions<QC extends QueryContext>(
  queryOperationTypes: Readonly<Record<string, SqlOperationEntry>>,
): AggregateFunctions<QC> {
  const baseFns = createFunctions<QC>(queryOperationTypes);
  const aggregates = createAggregateOnlyFunctions();

  return new Proxy({} as AggregateFunctions<QC>, {
    get(_target, prop: string) {
      const agg = (aggregates as Record<string, unknown>)[prop];
      if (agg) return agg;

      return (baseFns as Record<string, unknown>)[prop];
    },
  });
}
