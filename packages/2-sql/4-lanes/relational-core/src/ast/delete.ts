import type { BinaryExpr, ColumnRef, DeleteAst, TableRef } from './types.ts';
import { compact } from './util.ts';

export interface CreateDeleteAstOptions {
  readonly table: TableRef;
  readonly where: BinaryExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createDeleteAst(options: CreateDeleteAstOptions): DeleteAst {
  return compact({
    kind: 'delete',
    table: options.table,
    where: options.where,
    returning: options.returning,
  }) as DeleteAst;
}
