import type {
  BinaryExpr,
  BinaryOp,
  ExistsExpr,
  Expression,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  ParamRef,
  SelectAst,
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
