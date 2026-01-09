import type {
  ColumnRef,
  Direction,
  IncludeAst,
  IncludeRef,
  JoinAst,
  OperationExpr,
  SelectAst,
  TableRef,
  WhereExpr,
} from './types';
import { compact } from './util';

export interface CreateSelectAstOptions {
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly includes?: ReadonlyArray<IncludeAst>;
  readonly project: ReadonlyArray<{
    alias: string;
    expr: ColumnRef | IncludeRef | OperationExpr;
  }>;
  readonly where?: WhereExpr;
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef | OperationExpr; dir: Direction }>;
  readonly limit?: number;
}

export function createSelectAst(options: CreateSelectAstOptions): SelectAst {
  return compact({
    kind: 'select',
    from: options.from,
    joins: options.joins,
    includes: options.includes,
    project: options.project,
    where: options.where,
    orderBy: options.orderBy,
    limit: options.limit,
  }) as SelectAst;
}
