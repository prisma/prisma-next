import type { ColumnRef, InsertAst, ParamRef, TableRef } from './types';
import { compact } from './util';

export interface CreateInsertAstOptions {
  readonly table: TableRef;
  readonly values: Record<string, ColumnRef | ParamRef>;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createInsertAst(options: CreateInsertAstOptions): InsertAst {
  return compact({
    kind: 'insert',
    table: options.table,
    values: options.values,
    returning: options.returning,
  }) as InsertAst;
}
