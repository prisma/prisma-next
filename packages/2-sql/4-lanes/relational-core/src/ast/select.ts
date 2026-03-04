import type {
  Expression,
  FromSource,
  JoinAst,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  WhereExpr,
} from './types';
import { compact } from './util';

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
  return compact({
    kind: 'select',
    from: options.from,
    joins: options.joins,
    project: options.project,
    where: options.where,
    orderBy: options.orderBy,
    distinct: options.distinct,
    distinctOn: options.distinctOn,
    groupBy: options.groupBy,
    having: options.having,
    limit: options.limit,
    offset: options.offset,
    selectAllIntent: options.selectAllIntent,
  }) as SelectAst;
}
