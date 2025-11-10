import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
} from '@prisma-next/sql-target';

export function createBinaryExpr(
  op: 'eq',
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
