import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef, TableRef } from './types';
import { compact } from './util';

export function createTableRef(name: string): TableRef {
  return {
    kind: 'table',
    name,
  };
}

export function createColumnRef(table: string, column: string): ColumnRef {
  return {
    kind: 'col',
    table,
    column,
  };
}

export function createParamRef(index: number, name?: string): ParamRef {
  return compact({
    kind: 'param',
    index,
    name,
  }) as ParamRef;
}

export function createOperationExpr(operation: OperationExpr): OperationExpr {
  return operation;
}

export function createLiteralExpr(value: unknown): LiteralExpr {
  return {
    kind: 'literal',
    value,
  };
}
