import type { ColumnRef, DeleteAst, TableRef, WhereExpr } from './types';
import { compact } from './util';

export interface CreateDeleteAstOptions {
  readonly table: TableRef;
  readonly where: WhereExpr;
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
