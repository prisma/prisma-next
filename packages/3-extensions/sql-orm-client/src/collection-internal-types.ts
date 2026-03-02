import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { Collection } from './collection';
import type {
  CollectionContext,
  CollectionTypeState,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeCombine,
  IncludeCombineBranch,
  IncludeRelationValue,
  IncludeScalar,
  ModelAccessor,
  RelationCardinality,
  ShorthandWhereFilter,
} from './types';

export interface CollectionInit<TContract extends SqlContract<SqlStorage>> {
  readonly tableName?: string | undefined;
  readonly state?: import('./types').CollectionState | undefined;
  readonly registry?: ReadonlyMap<string, CollectionConstructor<TContract>> | undefined;
  readonly includeRefinementMode?: boolean | undefined;
}

export type CollectionConstructor<TContract extends SqlContract<SqlStorage>> = new (
  ctx: CollectionContext<TContract>,
  modelName: string,
  options?: CollectionInit<TContract>,
) => Collection<TContract, string, unknown, CollectionTypeState>;

export type WithWhereState<State extends CollectionTypeState> = Omit<State, 'hasWhere'> & {
  readonly hasWhere: true;
};

export type WithOrderByState<State extends CollectionTypeState> = Omit<State, 'hasOrderBy'> & {
  readonly hasOrderBy: true;
};

export type IncludedRelationsForRow<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
> = Omit<Row, keyof DefaultModelRow<TContract, ModelName>>;

export type IncludeRefinementTerminals =
  | 'all'
  | 'first'
  | 'aggregate'
  | 'groupBy'
  | 'create'
  | 'createAll'
  | 'createCount'
  | 'update'
  | 'updateAll'
  | 'updateCount'
  | 'delete'
  | 'deleteAll'
  | 'deleteCount'
  | 'upsert';

export type IncludeRefinementScalarMethods = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'combine';

export type IncludeRefinementCollection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
  IsToMany extends boolean,
> = Omit<
  Collection<TContract, ModelName, Row, State>,
  IncludeRefinementTerminals | (IsToMany extends true ? never : IncludeRefinementScalarMethods)
>;

export type IsToManyRelation<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = RelationCardinality<TContract, ModelName, RelName> extends '1:N' | 'M:N' ? true : false;

export type IncludeRefinementResult<
  TContract extends SqlContract<SqlStorage>,
  RelatedName extends string,
  IsToMany extends boolean,
> =
  | IncludeRefinementCollection<TContract, RelatedName, unknown, CollectionTypeState, IsToMany>
  | (IsToMany extends true
      ? IncludeScalar<unknown> | IncludeCombine<Record<string, unknown>>
      : never);

export type IncludeRefinementValue<
  TContract extends SqlContract<SqlStorage>,
  ParentModelName extends string,
  RelName extends string,
  DefaultIncludedRow,
  RefinedResult,
> = RefinedResult extends IncludeScalar<infer ScalarResult>
  ? ScalarResult
  : RefinedResult extends IncludeCombine<infer CombinedResult>
    ? CombinedResult
    : RefinedResult extends Collection<TContract, string, infer IncludedRow, CollectionTypeState>
      ? IncludeRelationValue<TContract, ParentModelName, RelName, IncludedRow>
      : IncludeRelationValue<TContract, ParentModelName, RelName, DefaultIncludedRow>;

export type WhereInput<TContract extends SqlContract<SqlStorage>, ModelName extends string> =
  | ((model: ModelAccessor<TContract, ModelName>) => WhereExpr)
  | ShorthandWhereFilter<TContract, ModelName>;

export interface IncludeRefinementEvaluation {
  readonly nestedState: import('./types').CollectionState;
  readonly scalarSelector: IncludeScalar<unknown> | undefined;
  readonly combineBranches: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

export type IncludeRefinementHandler<
  TContract extends SqlContract<SqlStorage>,
  RelatedName extends string,
  IsToMany extends boolean,
> = (
  collection: IncludeRefinementCollection<
    TContract,
    RelatedName,
    DefaultModelRow<TContract, RelatedName>,
    DefaultCollectionTypeState,
    IsToMany
  >,
) => IncludeRefinementResult<TContract, RelatedName, IsToMany>;
