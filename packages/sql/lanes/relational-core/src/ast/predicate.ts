import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  LogicalExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
} from './types';

export function createBinaryExpr(
  op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte',
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

export function createLogicalExpr(
  op: 'and' | 'or',
  left: BinaryExpr | ExistsExpr | LogicalExpr,
  right: BinaryExpr | ExistsExpr | LogicalExpr,
): LogicalExpr {
  return {
    kind: 'logical',
    op,
    left,
    right,
  };
}
