import type {
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoFilterExpr,
  MongoNotExpr,
  MongoOrExpr,
} from './filter-expressions';
import type {
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from './stages';

export interface MongoFilterVisitor<R> {
  field(expr: MongoFieldFilter): R;
  and(expr: MongoAndExpr): R;
  or(expr: MongoOrExpr): R;
  not(expr: MongoNotExpr): R;
  exists(expr: MongoExistsExpr): R;
}

export interface MongoFilterRewriter {
  field?(expr: MongoFieldFilter): MongoFilterExpr;
  and?(expr: MongoAndExpr): MongoFilterExpr;
  or?(expr: MongoOrExpr): MongoFilterExpr;
  not?(expr: MongoNotExpr): MongoFilterExpr;
  exists?(expr: MongoExistsExpr): MongoFilterExpr;
}

export interface MongoStageVisitor<R> {
  match(stage: MongoMatchStage): R;
  project(stage: MongoProjectStage): R;
  sort(stage: MongoSortStage): R;
  limit(stage: MongoLimitStage): R;
  skip(stage: MongoSkipStage): R;
  lookup(stage: MongoLookupStage): R;
  unwind(stage: MongoUnwindStage): R;
}
