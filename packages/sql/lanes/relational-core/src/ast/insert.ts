import type { ColumnRef, InsertAst, ParamRef, TableRef } from '@prisma-next/sql-target';

export interface CreateInsertAstOptions {
  readonly table: TableRef;
  readonly values: Record<string, ColumnRef | ParamRef>;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createInsertAst(options: CreateInsertAstOptions): InsertAst {
  return {
    kind: 'insert',
    table: options.table,
    values: options.values,
    ...(options.returning && options.returning.length > 0 ? { returning: options.returning } : {}),
  };
}
