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

export function param(value: unknown, name?: string): ParamRef {
  return name !== undefined ? ParamRef.of(value, { name }) : ParamRef.of(value);
}

export function shiftParamRef(delta: number): (expr: ParamRef) => ParamRef {
  return (expr: ParamRef) =>
    ParamRef.of(typeof expr.value === 'number' ? (expr.value as number) + delta : expr.value, {
      ...(expr.name !== undefined && { name: expr.name }),
      ...(expr.codecId !== undefined && { codecId: expr.codecId }),
      ...(expr.nativeType !== undefined && { nativeType: expr.nativeType }),
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
    template: 'lower(${self})',
  });
}

export function simpleSelect(tableName: string, columns: ReadonlyArray<string>): SelectAst {
  return columns.reduce(
    (ast, column) => ast.addProjection(column, col(tableName, column)),
    SelectAst.from(table(tableName)),
  );
}
