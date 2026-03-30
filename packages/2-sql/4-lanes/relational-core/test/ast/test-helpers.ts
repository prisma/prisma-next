import { ifDefined } from '@prisma-next/utils/defined';
import {
  type AnyOperationArg,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';

export const stringReturn = { kind: 'builtin', type: 'string' } as const;

export function table(name: string, alias?: string): TableSource {
  return TableSource.named(name, alias);
}

export function col(tableName: string, column: string): ColumnRef {
  return ColumnRef.of(tableName, column);
}

export function param(value: unknown, name?: string, codecId = 'pg/text@1'): ParamRef {
  return ParamRef.of(value, { ...ifDefined('name', name), codecId });
}

export function shiftParamRef(delta: number): (expr: ParamRef) => ParamRef {
  return (expr: ParamRef) =>
    ParamRef.of(typeof expr.value === 'number' ? expr.value + delta : expr.value, {
      ...ifDefined('name', expr.name),
      ...ifDefined('codecId', expr.codecId),
    });
}

export function lit(value: unknown): LiteralExpr {
  return LiteralExpr.of(value);
}

export function lowerExpr(column: ColumnRef, ...args: Array<AnyOperationArg>): OperationExpr {
  return OperationExpr.function({
    method: 'lower',
    forTypeId: 'pg/text@1',
    self: column,
    args,
    returns: stringReturn,
    template: 'lower({{self}})',
  });
}

export function simpleSelect(tableName: string, columns: ReadonlyArray<string>): SelectAst {
  return columns.reduce(
    (ast, column) => ast.addProjection(column, col(tableName, column)),
    SelectAst.from(table(tableName)),
  );
}
