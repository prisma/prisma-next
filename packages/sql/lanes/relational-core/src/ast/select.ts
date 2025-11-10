import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  ExistsExpr,
  IncludeAst,
  IncludeRef,
  JoinAst,
  OperationExpr,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-target';

export interface CreateSelectAstOptions {
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly includes?: ReadonlyArray<IncludeAst>;
  readonly project: ReadonlyArray<{
    alias: string;
    expr: ColumnRef | IncludeRef | OperationExpr;
  }>;
  readonly where?: BinaryExpr | ExistsExpr;
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef | OperationExpr; dir: Direction }>;
  readonly limit?: number;
}

export function createSelectAst(options: CreateSelectAstOptions): SelectAst {
  return {
    kind: 'select',
    from: options.from,
    ...(options.joins && options.joins.length > 0 ? { joins: options.joins } : {}),
    ...(options.includes && options.includes.length > 0 ? { includes: options.includes } : {}),
    project: options.project,
    ...(options.where ? { where: options.where } : {}),
    ...(options.orderBy ? { orderBy: options.orderBy } : {}),
    ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
  };
}
