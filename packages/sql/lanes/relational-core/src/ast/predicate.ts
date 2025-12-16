import type {
  BinaryExpr,
  BinaryOp,
  ColumnRef,
  ExistsExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
} from './types';

export function createBinaryExpr(
  op: BinaryOp,
  left: ColumnRef | OperationExpr,
  right: ParamRef,
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
