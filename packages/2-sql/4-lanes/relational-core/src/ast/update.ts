import type { ColumnRef, ParamRef, TableSource, UpdateAst, WhereExpr } from './types';
import { compact } from './util';

export interface CreateUpdateAstOptions {
  readonly table: TableSource;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where?: WhereExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export function createUpdateAst(options: CreateUpdateAstOptions): UpdateAst {
  return compact({
    kind: 'update',
    table: options.table,
    set: options.set,
    where: options.where,
    returning: options.returning,
  }) as UpdateAst;
}
