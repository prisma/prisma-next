import type { BinaryExpr, ColumnRef, DeleteAst, TableRef } from '@prisma-next/sql-target';

export interface CreateDeleteAstOptions {
  readonly table: TableRef;
  readonly where: BinaryExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createDeleteAst(options: CreateDeleteAstOptions): DeleteAst {
  return {
    kind: 'delete',
    table: options.table,
    where: options.where,
    ...(options.returning && options.returning.length > 0 ? { returning: options.returning } : {}),
  };
}
