import { ifDefined } from '@prisma-next/utils/defined';
import type { ColumnRef, InsertAst, InsertOnConflictAst, InsertValue, TableSource } from './types';

export interface CreateInsertAstOptions {
  readonly table: TableSource;
  readonly rows: ReadonlyArray<Record<string, InsertValue>>;
  readonly onConflict?: InsertOnConflictAst;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createInsertAst(options: CreateInsertAstOptions): InsertAst {
  return {
    kind: 'insert',
    table: options.table,
    rows: options.rows,
    ...ifDefined('onConflict', options.onConflict),
    ...ifDefined(
      'returning',
      options.returning && options.returning.length > 0 ? options.returning : undefined,
    ),
  };
}
