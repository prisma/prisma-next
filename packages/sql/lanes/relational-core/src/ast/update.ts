import type { BinaryExpr, ColumnRef, ParamRef, TableRef, UpdateAst } from '@prisma-next/sql-target';

export interface CreateUpdateAstOptions {
  readonly table: TableRef;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where: BinaryExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createUpdateAst(options: CreateUpdateAstOptions): UpdateAst {
  return {
    kind: 'update',
    table: options.table,
    set: options.set,
    where: options.where,
    ...(options.returning && options.returning.length > 0 ? { returning: options.returning } : {}),
  };
}
