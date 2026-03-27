import {
  AggregateExpr,
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  OperationExpr,
  OrExpr,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { QueryOperationEntry } from '@prisma-next/sql-relational-core/query-operations';
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
import type { ParamCollector } from './param-collector';

type CodecTypes = Record<string, { readonly input: unknown }>;
type ExprOrVal<T extends ScopeField = ScopeField> = ExpressionOrValue<T, CodecTypes>;

const BOOL_FIELD: BooleanCodecType = { codecId: 'pg/bool@1', nullable: false };

function resolve(value: ExprOrVal, pc: ParamCollector): AstExpression {
  if (value instanceof ExpressionImpl) return value.buildAst();
  return pc.add(value);
}

function resolveToAst(value: ExprOrVal): AstExpression {
  if (value instanceof ExpressionImpl) return value.buildAst();
  return new LiteralExpr(value);
}

function boolExpr(astNode: AstExpression): ExpressionImpl<BooleanCodecType> {
  return new ExpressionImpl(astNode, BOOL_FIELD);
}

function comparison(
  a: ExprOrVal,
  b: ExprOrVal,
  op: BinaryOp,
  pc: ParamCollector,
): ExpressionImpl<BooleanCodecType> {
  return boolExpr(new BinaryExpr(op, resolve(a, pc), resolve(b, pc)));
}

function inOrNotIn(
  expr: Expression<ScopeField>,
  valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
  op: 'in' | 'notIn',
  pc: ParamCollector,
): ExpressionImpl<BooleanCodecType> {
  const left = expr.buildAst();
  const binaryFn = op === 'in' ? BinaryExpr.in : BinaryExpr.notIn;

  if (Array.isArray(valuesOrSubquery)) {
    const refs = valuesOrSubquery.map((v) => resolve(v, pc));
    return boolExpr(binaryFn(left, ListExpression.of(refs)));
  }
  return boolExpr(binaryFn(left, SubqueryExpr.of(valuesOrSubquery.buildAst())));
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

function createBuiltinFunctions(pc: ParamCollector) {
  return {
    eq: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'eq', pc),
    ne: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'neq', pc),
    gt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gt', pc),
    gte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gte', pc),
    lt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lt', pc),
    lte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lte', pc),
    and: (...exprs: ExprOrVal<BooleanCodecType>[]) => boolExpr(AndExpr.of(exprs.map(resolveToAst))),
    or: (...exprs: ExprOrVal<BooleanCodecType>[]) => boolExpr(OrExpr.of(exprs.map(resolveToAst))),
    exists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.exists(subquery.buildAst())),
    notExists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.notExists(subquery.buildAst())),
    in: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'in', pc),
    notIn: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'notIn', pc),
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
  entry: QueryOperationEntry,
  pc: ParamCollector,
): (...args: ExprOrVal[]) => ExpressionImpl {
  return (...args: ExprOrVal[]) => {
    const resolvedArgs = args.map((arg, i) => {
      if (arg instanceof ExpressionImpl) return arg.buildAst();
      const codecId = entry.args[i]?.codecId;
      return pc.add(arg, codecId ? { codecId } : {});
    });
    const self = resolvedArgs[0] as AstExpression;
    const restArgs = resolvedArgs.slice(1);

    return new ExpressionImpl(
      new OperationExpr({
        method: name,
        forTypeId: entry.args[0]?.codecId ?? 'unknown',
        self,
        args: restArgs.length > 0 ? restArgs : undefined,
        returns: { kind: 'typeId', type: entry.returns.codecId },
        lowering: entry.lowering,
      }),
      entry.returns,
    );
  };
}

export function createFunctions<QC extends QueryContext>(
  paramCollector: ParamCollector,
  queryOperationTypes: Readonly<Record<string, QueryOperationEntry>>,
): Functions<QC> {
  const builtins = createBuiltinFunctions(paramCollector);

  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      const builtin = (builtins as Record<string, unknown>)[prop];
      if (builtin) return builtin;

      const extOp = queryOperationTypes[prop];
      if (extOp) {
        return createExtensionFunction(prop, extOp, paramCollector);
      }
      return undefined;
    },
  });
}

export function createAggregateFunctions<QC extends QueryContext>(
  paramCollector: ParamCollector,
  queryOperationTypes: Readonly<Record<string, QueryOperationEntry>>,
): AggregateFunctions<QC> {
  const baseFns = createFunctions<QC>(paramCollector, queryOperationTypes);
  const aggregates = createAggregateOnlyFunctions();

  return new Proxy({} as AggregateFunctions<QC>, {
    get(_target, prop: string) {
      const agg = (aggregates as Record<string, unknown>)[prop];
      if (agg) return agg;

      return (baseFns as Record<string, unknown>)[prop];
    },
  });
}
