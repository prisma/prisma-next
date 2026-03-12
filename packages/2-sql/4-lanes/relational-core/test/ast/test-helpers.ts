import {
  ColumnRef,
  type Expression,
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

export function param(index: number, name?: string): ParamRef {
  return ParamRef.of(index, name);
}

export function lit(value: unknown): LiteralExpr {
  return LiteralExpr.of(value);
}

export function lowerExpr(
  column: ColumnRef,
  ...args: Array<Expression | ParamRef | LiteralExpr>
): OperationExpr {
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
    (ast, column) => ast.addProject(column, col(tableName, column)),
    SelectAst.from(table(tableName)),
  );
}
