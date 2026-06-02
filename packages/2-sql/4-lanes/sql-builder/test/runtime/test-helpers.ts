import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  type CodecRef,
  ColumnRef,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { codecOf, toExpr } from '@prisma-next/sql-relational-core/expression';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import type { ScopeField, Subquery } from '../../src/scope';

const int4: ScopeField = { codecId: 'pg/int4@1', nullable: false, codec: { codecId: 'pg/int4@1' } };
const text: ScopeField = { codecId: 'pg/text@1', nullable: false, codec: { codecId: 'pg/text@1' } };

export const usersScope = {
  topLevel: { id: int4, name: text, email: text },
  namespaces: {
    users: { id: int4, name: text, email: text },
  },
} as const;

export const joinedScope = {
  topLevel: { name: text, title: text },
  namespaces: {
    users: { id: int4, name: text },
    posts: { id: int4, title: text, user_id: int4 },
  },
} as const;

export function makeSubquery(): { buildAst(): SelectAst } {
  const ast = SelectAst.from(TableSource.named('posts')).addProjection(
    'id',
    ColumnRef.of('posts', 'id'),
  );
  return { buildAst: () => ast };
}

/**
 * Local test fixture: a minimal SQL operations map for exercising
 * `createFunctions` / `createAggregateFunctions`. Replicates the impl
 * shapes the SQL family registers at runtime — sufficient for unit-testing
 * the registry-lookup Proxy and the impls' AST-emission contracts (codec
 * propagation, null short-circuits, list/subquery dispatch). The sql-builder
 * package does not depend on `@prisma-next/family-sql`, so the impls live
 * here rather than being imported from the family package.
 */
const BOOL_FIELD = { codecId: 'pg/bool@1' as const, nullable: false as const };

function isExpressionLike(value: unknown): value is { buildAst(): AstExpression } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  );
}

function boolExpr(ast: AstExpression): ExpressionImpl<typeof BOOL_FIELD> {
  return new ExpressionImpl(ast, BOOL_FIELD);
}

function resolveOperand(operand: unknown, otherCodec: CodecRef | undefined): AstExpression {
  if (isExpressionLike(operand)) return operand.buildAst();
  return toExpr(operand, otherCodec);
}

function binaryWithSharedCodec(a: unknown, b: unknown, op: BinaryOp): AstExpression {
  const aCodec = codecOf(a);
  const bCodec = codecOf(b);
  const left = resolveOperand(a, bCodec);
  const right = resolveOperand(b, aCodec);
  return new BinaryExpr(op, left, right);
}

function toLiteralExpr(value: unknown): AstExpression {
  if (isExpressionLike(value)) return value.buildAst();
  return new LiteralExpr(value);
}

// Local helper that bridges the test-side impls (loosely typed for fixture
// brevity) to the registry's strictly-typed `SqlOperationEntry`. Production
// families construct entries through `satisfies QueryOperationTypes<CT>`
// which derives the precise signature; here the fixture exists only to
// exercise the runtime Proxy + AST emission, so the bridge is the single
// load-bearing cast — narrower than casting each impl individually.
type LooseImpl = (...args: never[]) => unknown;
function entry(impl: (...args: never[]) => unknown): SqlOperationEntry {
  return { impl: impl as SqlOperationEntry['impl'] };
}

/**
 * Concrete typed view over `testOperations` for use in the unit tests —
 * loose enough to accept `Expression<ScopeField>` operands and raw values,
 * tight enough that callers see `result.buildAst()` (an
 * `ExpressionImpl<BooleanCodecType>`). This mirrors the surface tests had
 * pre-slice-3 when `BuiltinFunctions<CT>` was the source-of-truth — but
 * now the impls live in `testOperations` and the registry-lookup Proxy
 * dispatches to them.
 */
type BoolExpr = ExpressionImpl<typeof BOOL_FIELD>;
export type TestFunctions = {
  eq: (a: unknown, b: unknown) => BoolExpr;
  neq: (a: unknown, b: unknown) => BoolExpr;
  gt: (a: unknown, b: unknown) => BoolExpr;
  gte: (a: unknown, b: unknown) => BoolExpr;
  lt: (a: unknown, b: unknown) => BoolExpr;
  lte: (a: unknown, b: unknown) => BoolExpr;
  and: (...exprs: unknown[]) => BoolExpr;
  or: (...exprs: unknown[]) => BoolExpr;
  exists: (subquery: Subquery<Record<string, ScopeField>>) => BoolExpr;
  notExists: (subquery: Subquery<Record<string, ScopeField>>) => BoolExpr;
  in: (
    expr: { buildAst(): AstExpression },
    valuesOrSubquery: Subquery<Record<string, ScopeField>> | unknown[],
  ) => BoolExpr;
  notIn: (
    expr: { buildAst(): AstExpression },
    valuesOrSubquery: Subquery<Record<string, ScopeField>> | unknown[],
  ) => BoolExpr;
};

/** `TestFunctions` plus the always-present aggregate combinators. */
export type TestAggregateFunctions = TestFunctions & {
  count: (expr?: unknown) => ExpressionImpl<{ codecId: 'pg/int8@1'; nullable: false }>;
  sum: (expr: unknown) => ExpressionImpl<{ codecId: string; nullable: true }>;
  avg: (expr: unknown) => ExpressionImpl<{ codecId: string; nullable: true }>;
  min: (expr: unknown) => ExpressionImpl<{ codecId: string; nullable: true }>;
  max: (expr: unknown) => ExpressionImpl<{ codecId: string; nullable: true }>;
};

export const testOperations: Readonly<Record<string, SqlOperationEntry>> = {
  eq: entry(((a: unknown, b: unknown) => {
    if (b === null) return boolExpr(NullCheckExpr.isNull(toExpr(a)));
    if (a === null) return boolExpr(NullCheckExpr.isNull(toExpr(b)));
    return boolExpr(binaryWithSharedCodec(a, b, 'eq'));
  }) as LooseImpl),
  neq: entry(((a: unknown, b: unknown) => {
    if (b === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(a)));
    if (a === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(b)));
    return boolExpr(binaryWithSharedCodec(a, b, 'neq'));
  }) as LooseImpl),
  gt: entry(((a: unknown, b: unknown) => boolExpr(binaryWithSharedCodec(a, b, 'gt'))) as LooseImpl),
  gte: entry(((a: unknown, b: unknown) =>
    boolExpr(binaryWithSharedCodec(a, b, 'gte'))) as LooseImpl),
  lt: entry(((a: unknown, b: unknown) => boolExpr(binaryWithSharedCodec(a, b, 'lt'))) as LooseImpl),
  lte: entry(((a: unknown, b: unknown) =>
    boolExpr(binaryWithSharedCodec(a, b, 'lte'))) as LooseImpl),
  and: entry(((...exprs: unknown[]) =>
    boolExpr(AndExpr.of(exprs.map(toLiteralExpr)))) as LooseImpl),
  or: entry(((...exprs: unknown[]) => boolExpr(OrExpr.of(exprs.map(toLiteralExpr)))) as LooseImpl),
  exists: entry(((subquery: Subquery<Record<string, ScopeField>>) =>
    boolExpr(ExistsExpr.exists(subquery.buildAst()))) as LooseImpl),
  notExists: entry(((subquery: Subquery<Record<string, ScopeField>>) =>
    boolExpr(ExistsExpr.notExists(subquery.buildAst()))) as LooseImpl),
  in: entry(((
    expr: { buildAst(): AstExpression },
    valuesOrSubquery: Subquery<Record<string, ScopeField>> | unknown[],
  ) => {
    const left = expr.buildAst();
    const leftCodec = codecOf(expr);
    if (Array.isArray(valuesOrSubquery)) {
      const refs = valuesOrSubquery.map((v) => resolveOperand(v, leftCodec));
      return boolExpr(BinaryExpr.in(left, ListExpression.of(refs)));
    }
    return boolExpr(BinaryExpr.in(left, SubqueryExpr.of(valuesOrSubquery.buildAst())));
  }) as LooseImpl),
  notIn: entry(((
    expr: { buildAst(): AstExpression },
    valuesOrSubquery: Subquery<Record<string, ScopeField>> | unknown[],
  ) => {
    const left = expr.buildAst();
    const leftCodec = codecOf(expr);
    if (Array.isArray(valuesOrSubquery)) {
      const refs = valuesOrSubquery.map((v) => resolveOperand(v, leftCodec));
      return boolExpr(BinaryExpr.notIn(left, ListExpression.of(refs)));
    }
    return boolExpr(BinaryExpr.notIn(left, SubqueryExpr.of(valuesOrSubquery.buildAst())));
  }) as LooseImpl),
};
