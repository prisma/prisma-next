import type {
  BinaryExpr,
  BinaryOp,
  ColumnRef,
  ExistsExpr,
  NullCheckExpr,
  NullCheckOp,
  OperationExpr,
  ParamRef,
  SelectAst,
} from './types';

export function createBinaryExpr(
  op: BinaryOp,
  left: ColumnRef | OperationExpr,
  right: ColumnRef | ParamRef,
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

export function createNullCheckExpr(
  op: NullCheckOp,
  expr: ColumnRef | OperationExpr,
): NullCheckExpr {
  return {
    kind: 'nullCheck',
    op,
    expr,
  };
}
