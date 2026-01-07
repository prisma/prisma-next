import type { BinaryExpr, BinaryOp, ExistsExpr, Expression, ParamRef, SelectAst } from './types.ts';

export function createBinaryExpr(
  op: BinaryOp,
  left: Expression,
  right: Expression | ParamRef,
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
