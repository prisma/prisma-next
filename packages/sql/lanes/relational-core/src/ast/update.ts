import type { ColumnRef, ParamRef, PredicateExpr, TableRef, UpdateAst } from './types';
import { compact } from './util';

export interface CreateUpdateAstOptions {
  readonly table: TableRef;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where: PredicateExpr;
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
