import { createLiteralExpr } from './common';
import type {
  AndExpr,
  BinaryExpr,
  BinaryOp,
  ExistsExpr,
  Expression,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
  SelectAst,
  WhereExpr,
} from './types';

export function createBinaryExpr(
  op: BinaryOp,
  left: Expression,
  right: Expression | ParamRef | LiteralExpr | ListLiteralExpr,
): BinaryExpr {
  return {
    kind: 'bin',
    op,
    left,
    right,
  };
}

export function createExistsExpr(not: boolean, subquery: SelectAst): ExistsExpr {
  return {
    kind: 'exists',
    not,
    subquery,
  };
}

export function createNullCheckExpr(expr: Expression, isNull: boolean): NullCheckExpr {
  return {
    kind: 'nullCheck',
    expr,
    isNull,
  };
}

export function createAndExpr(exprs: ReadonlyArray<WhereExpr>): AndExpr {
  return {
    kind: 'and',
    exprs,
  };
}

export function createOrExpr(exprs: ReadonlyArray<WhereExpr>): OrExpr {
  return {
    kind: 'or',
    exprs,
  };
}

export function createListLiteralExpr(
  values: ReadonlyArray<ParamRef | LiteralExpr>,
): ListLiteralExpr {
  return {
    kind: 'listLiteral',
    values,
  };
}

export function createTrueExpr(): AndExpr {
  return createAndExpr([]);
}

export function createFalseExpr(): OrExpr {
  return createOrExpr([]);
}

export function createLiteralListFromValues(values: ReadonlyArray<unknown>): ListLiteralExpr {
  return createListLiteralExpr(values.map((value) => createLiteralExpr(value)));
}
