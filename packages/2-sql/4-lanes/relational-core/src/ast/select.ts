import type {
  Expression,
  FromSource,
  JoinAst,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  WhereExpr,
} from './types';

export interface CreateSelectAstOptions {
  readonly from: FromSource;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly project: ReadonlyArray<ProjectionItem>;
  readonly where?: WhereExpr;
  readonly orderBy?: ReadonlyArray<OrderByItem>;
  readonly distinct?: true;
  readonly distinctOn?: ReadonlyArray<Expression>;
  readonly groupBy?: ReadonlyArray<Expression>;
  readonly having?: WhereExpr;
  readonly limit?: number;
  readonly offset?: number;
  readonly selectAllIntent?: { table?: string };
}

export function createSelectAst(options: CreateSelectAstOptions): SelectAst {
  return {
    kind: 'select',
    from: options.from,
    project: options.project,
    ...(options.joins && options.joins.length > 0 ? { joins: options.joins } : {}),
    ...(options.where ? { where: options.where } : {}),
    ...(options.orderBy && options.orderBy.length > 0 ? { orderBy: options.orderBy } : {}),
    ...(options.distinct ? { distinct: options.distinct } : {}),
    ...(options.distinctOn && options.distinctOn.length > 0
      ? { distinctOn: options.distinctOn }
      : {}),
    ...(options.groupBy && options.groupBy.length > 0 ? { groupBy: options.groupBy } : {}),
    ...(options.having ? { having: options.having } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.selectAllIntent ? { selectAllIntent: options.selectAllIntent } : {}),
  };
}
