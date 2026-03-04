import type { ColumnRef, InsertAst, InsertOnConflictAst, ParamRef, TableSource } from './types';
import { compact } from './util';

export interface CreateInsertAstOptions {
  readonly table: TableSource;
  readonly values: Record<string, ColumnRef | ParamRef>;
  readonly onConflict?: InsertOnConflictAst;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createInsertAst(options: CreateInsertAstOptions): InsertAst {
  return compact({
    kind: 'insert',
    table: options.table,
    values: options.values,
    onConflict: options.onConflict,
    returning: options.returning,
  }) as InsertAst;
}
