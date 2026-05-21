/**
 * Runtime factory for the SQL family's query-operations contribution.
 *
 * Returns the 15 family-level operation descriptors registered into the
 * `SqlOperationRegistry` at execution-context construction:
 *
 *   - Equality predicates (trait `equality`): `eq`, `neq`, `in`, `notIn`
 *   - Order predicates (trait `order`): `gt`, `gte`, `lt`, `lte`
 *   - Textual predicate (trait `textual`): `like`
 *   - Null checks (any codec): `isNull`, `isNotNull`
 *   - Boolean composition (no `self`, sql-builder-only): `and`, `or`,
 *     `exists`, `notExists`
 *
 * Each `impl` builds the AST node verbatim from today's source-of-truth
 * surfaces (`BuiltinFunctions` in sql-builder; `COMPARISON_METHODS_META`
 * in sql-orm-client). Slice 3 will rewire the legacy consumers to read
 * from this registry; preserving byte-identical AST shapes here is what
 * keeps that deletion a no-op on emitted SQL.
 *
 * Lock-step with the type twin in `../types/operation-types.ts` is
 * enforced via `satisfies QueryOperationTypes<CT>` on the returned
 * literal — a drift in lowering shape vs. type-level signature surfaces
 * as a family-sql typecheck failure rather than a slice-3 SQL-emission
 * regression.
 */

import { ExpressionImpl } from '@prisma-next/sql-builder/runtime';
import type { Subquery } from '@prisma-next/sql-builder/types';
import {
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  type CodecRef,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  type CodecExpression,
  type CodecTypesBase,
  codecOf,
  type Expression,
  type ScopeField,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import type { QueryOperationTypes } from '../types/operation-types';

type PgBoolReturn = Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

const BOOL_FIELD = { codecId: 'pg/bool@1' as const, nullable: false as const };

/**
 * Wrap a relational-core AST node as an `Expression<PgBoolReturn>` —
 * identical wrapping shape to `boolExpr` in
 * `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts`.
 */
function boolExpr(ast: AstExpression): PgBoolReturn {
  return new ExpressionImpl(ast, BOOL_FIELD);
}

/**
 * Runtime-level operand union — accepts an `Expression` or any raw
 * value. Concrete codec typing lives on the public
 * `QueryOperationTypes<CT>` surface; the runtime impl widens to
 * `CodecExpression<string, boolean, CodecTypesBase>` so the body can be
 * shared across every codec id without per-call generic resolution.
 */
type ExprOrVal = CodecExpression<string, boolean, CodecTypesBase>;

function isExpressionLike(value: unknown): value is { buildAst(): AstExpression } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  );
}

/**
 * Resolve a binary-comparison operand into an AST node, threading the
 * column-bound side's {@link CodecRef} to the raw-value side — same
 * shape as `resolveOperand` in sql-builder's `functions.ts`.
 */
function resolveOperand(operand: ExprOrVal, otherCodec: CodecRef | undefined): AstExpression {
  if (isExpressionLike(operand)) return operand.buildAst();
  return toExpr(operand, otherCodec);
}

/**
 * Build a binary AST node with cross-codec resolution — copies the
 * `binaryWithSharedCodec` shape from sql-builder verbatim. Each side
 * forwards its codec ref so a raw value paired with a column-bound
 * expression picks up the column's codec at param materialisation.
 */
function binaryWithSharedCodec(a: ExprOrVal, b: ExprOrVal, op: BinaryOp): AstExpression {
  const aCodec = codecOf(a);
  const bCodec = codecOf(b);
  const left = resolveOperand(a, bCodec);
  const right = resolveOperand(b, aCodec);
  return new BinaryExpr(op, left, right);
}

/**
 * Wrap an Expression (via `buildAst`) or fall back to a `LiteralExpr` —
 * matches `toLiteralExpr` in sql-builder's `functions.ts`. Used by
 * `and` / `or` so callers can mix in raw `true` / `false` literals
 * that the SQL planner statically simplifies.
 */
function toLiteralExpr(value: unknown): AstExpression {
  if (isExpressionLike(value)) return value.buildAst();
  return new LiteralExpr(value);
}

/**
 * Family-SQL query-operations contribution. Structure mirrors
 * `pgvectorQueryOperations<CT>()` and is locked-step with D1's
 * `QueryOperationTypes<CT>` type twin via `satisfies`.
 */
export function sqlFamilyOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    // Equality predicates — trait-gated.
    // `eq` / `neq` preserve the implicit null-coalescing behaviour today
    // shared between `BuiltinFunctions.eq` (sql-builder/functions.ts:95-99)
    // and `scalarComparisonMethod('eq')` (sql-orm-client/types.ts:292-298):
    // a `null` operand short-circuits to `NullCheckExpr.isNull` /
    // `isNotNull` so users do not have to switch surface to express the
    // common `column.eq(maybeNull)` pattern.
    eq: {
      self: { traits: ['equality'] },
      impl: (a, b) => {
        if (b === null) return boolExpr(NullCheckExpr.isNull(toExpr(a)));
        if (a === null) return boolExpr(NullCheckExpr.isNull(toExpr(b)));
        return boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'eq'));
      },
    },
    neq: {
      self: { traits: ['equality'] },
      impl: (a, b) => {
        if (b === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(a)));
        if (a === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(b)));
        return boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'neq'));
      },
    },
    in: {
      self: { traits: ['equality'] },
      // Runtime branch on the second arg's shape — same dispatch as
      // `inOrNotIn` (sql-builder/functions.ts:111-125). The type twin
      // carries the two overload signatures so callers see the precise
      // signature; the runtime widens to the union and branches.
      impl: ((
        expr: Expression<ScopeField>,
        valuesOrSubquery: Subquery<Record<string, ScopeField>> | ReadonlyArray<ExprOrVal>,
      ): PgBoolReturn => {
        const left = expr.buildAst();
        const leftCodec = codecOf(expr);
        if (Array.isArray(valuesOrSubquery)) {
          const refs = valuesOrSubquery.map((v) => resolveOperand(v, leftCodec));
          return boolExpr(BinaryExpr.in(left, ListExpression.of(refs)));
        }
        const subquery = valuesOrSubquery as Subquery<Record<string, ScopeField>>;
        return boolExpr(BinaryExpr.in(left, SubqueryExpr.of(subquery.buildAst())));
      }) as QueryOperationTypes<CT>['in']['impl'],
    },
    notIn: {
      self: { traits: ['equality'] },
      impl: ((
        expr: Expression<ScopeField>,
        valuesOrSubquery: Subquery<Record<string, ScopeField>> | ReadonlyArray<ExprOrVal>,
      ): PgBoolReturn => {
        const left = expr.buildAst();
        const leftCodec = codecOf(expr);
        if (Array.isArray(valuesOrSubquery)) {
          const refs = valuesOrSubquery.map((v) => resolveOperand(v, leftCodec));
          return boolExpr(BinaryExpr.notIn(left, ListExpression.of(refs)));
        }
        const subquery = valuesOrSubquery as Subquery<Record<string, ScopeField>>;
        return boolExpr(BinaryExpr.notIn(left, SubqueryExpr.of(subquery.buildAst())));
      }) as QueryOperationTypes<CT>['notIn']['impl'],
    },

    // Order predicates — trait-gated.
    gt: {
      self: { traits: ['order'] },
      impl: (a, b) => boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'gt')),
    },
    gte: {
      self: { traits: ['order'] },
      impl: (a, b) => boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'gte')),
    },
    lt: {
      self: { traits: ['order'] },
      impl: (a, b) => boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'lt')),
    },
    lte: {
      self: { traits: ['order'] },
      impl: (a, b) => boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'lte')),
    },

    // Textual predicate — trait-gated.
    like: {
      self: { traits: ['textual'] },
      impl: (a, b) => boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'like')),
    },

    // Null checks — any codec.
    isNull: {
      self: { any: true },
      impl: (expr) => boolExpr(NullCheckExpr.isNull(expr.buildAst())),
    },
    isNotNull: {
      self: { any: true },
      impl: (expr) => boolExpr(NullCheckExpr.isNotNull(expr.buildAst())),
    },

    // Boolean composition — no `self` (sql-builder-only; never surfaces
    // as a column method).
    and: {
      impl: (...exprs) => boolExpr(AndExpr.of(exprs.map(toLiteralExpr))),
    },
    or: {
      impl: (...exprs) => boolExpr(OrExpr.of(exprs.map(toLiteralExpr))),
    },
    exists: {
      impl: (subquery) => boolExpr(ExistsExpr.exists(subquery.buildAst())),
    },
    notExists: {
      impl: (subquery) => boolExpr(ExistsExpr.notExists(subquery.buildAst())),
    },
  } satisfies QueryOperationTypes<CT>;
}
