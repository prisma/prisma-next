import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type {
  ExtractCodecTypes,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-contract/types';
import type { AnyWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import {
  BinaryExpr,
  type CodecTrait,
  type ColumnRef,
  LiteralExpr,
  ListLiteralExpr,
  NullCheckExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';
import type { RowSelection } from './collection-internal-types';

// ---------------------------------------------------------------------------
// Comparison / Filter / Order / Include
// ---------------------------------------------------------------------------

export interface OrderExpr {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export type OrderByDirective = OrderExpr;

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface IncludeScalar<Result> extends RowSelection<Result> {
  readonly kind: 'includeScalar';
  readonly fn: AggregateFn;
  readonly column?: string;
  readonly state: CollectionState;
}

export interface IncludeRowsBranch {
  readonly kind: 'rows';
  readonly state: CollectionState;
}

export interface IncludeScalarBranch {
  readonly kind: 'scalar';
  readonly selector: IncludeScalar<unknown>;
}

export type IncludeCombineBranch = IncludeRowsBranch | IncludeScalarBranch;

export interface IncludeCombine<ResultShape extends Record<string, unknown>>
  extends RowSelection<ResultShape> {
  readonly kind: 'includeCombine';
  readonly branches: Readonly<Record<string, IncludeCombineBranch>>;
}

export interface IncludeExpr {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly fkColumn: string;
  readonly parentPkColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly nested: CollectionState;
  readonly scalar: IncludeScalar<unknown> | undefined;
  readonly combine: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

// ---------------------------------------------------------------------------
// CollectionState — plain data, no query builder types
// ---------------------------------------------------------------------------

export interface CollectionState {
  readonly filters: readonly AnyWhereExpr[];
  readonly includes: readonly IncludeExpr[];
  readonly orderBy: readonly OrderExpr[] | undefined;
  readonly cursor: Readonly<Record<string, unknown>> | undefined;
  readonly distinct: readonly string[] | undefined;
  readonly distinctOn: readonly string[] | undefined;
  readonly selectedFields: readonly string[] | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
}

export function emptyState(): CollectionState {
  return {
    filters: [],
    includes: [],
    orderBy: undefined,
    cursor: undefined,
    distinct: undefined,
    distinctOn: undefined,
    selectedFields: undefined,
    limit: undefined,
    offset: undefined,
  };
}

export interface CollectionTypeState {
  readonly hasOrderBy: boolean;
  readonly hasWhere: boolean;
  readonly hasUniqueFilter: boolean;
}

export type RelationCardinalityTag = '1:1' | 'N:1' | '1:N' | 'M:N';

export type DefaultCollectionTypeState = {
  readonly hasOrderBy: false;
  readonly hasWhere: false;
  readonly hasUniqueFilter: false;
};

// ---------------------------------------------------------------------------
// CollectionContext — bundles lane context + runtime
// ---------------------------------------------------------------------------

export interface RuntimeScope {
  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row>;
}

export interface RuntimeConnection extends RuntimeScope {
  release?(): Promise<void>;
  transaction?(): Promise<RuntimeTransaction>;
}

export interface RuntimeTransaction extends RuntimeScope {
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
}

export interface RuntimeQueryable extends RuntimeScope {
  connection?(): Promise<RuntimeConnection>;
  transaction?(): Promise<RuntimeTransaction>;
}

export interface CollectionContext<TContract extends SqlContract<SqlStorage>> {
  readonly runtime: RuntimeQueryable;
  readonly context: ExecutionContext<TContract>;
}

// ---------------------------------------------------------------------------
// ModelAccessor — type-safe proxy for where() callbacks
// ---------------------------------------------------------------------------

export type ComparisonMethodFns<T> = {
  eq(value: T): AnyWhereExpr;
  neq(value: T): AnyWhereExpr;
  gt(value: T): AnyWhereExpr;
  lt(value: T): AnyWhereExpr;
  gte(value: T): AnyWhereExpr;
  lte(value: T): AnyWhereExpr;
  like(pattern: string): AnyWhereExpr;
  ilike(pattern: string): AnyWhereExpr;
  in(values: readonly T[]): AnyWhereExpr;
  notIn(values: readonly T[]): AnyWhereExpr;
  isNull(): AnyWhereExpr;
  isNotNull(): AnyWhereExpr;
  asc(): OrderByDirective;
  desc(): OrderByDirective;
};

/**
 * Trait-gated comparison methods. Only methods whose required traits are
 * all present in `Traits` are included.
 *
 * - `traits: []` → always available (isNull, isNotNull)
 */
export type ComparisonMethods<T, Traits> = {
  [K in keyof ComparisonMethodsMeta as [ComparisonMethodsMeta[K]['traits'][number]] extends [Traits]
    ? K
    : never]: ComparisonMethodFns<T>[K];
};

// ---------------------------------------------------------------------------
// COMPARISON_METHODS_META — single source of truth for traits + factories
// ---------------------------------------------------------------------------

function literal(value: unknown): LiteralExpr {
  return LiteralExpr.of(value);
}

function listLiteral(values: readonly unknown[]): ListLiteralExpr {
  return ListLiteralExpr.fromValues(values);
}

function bin(op: BinaryExpr['op'], column: ColumnRef, right: BinaryExpr['right']): BinaryExpr {
  return new BinaryExpr(op, column, right);
}

type MethodFactory = (column: ColumnRef) => (...args: never[]) => unknown;

type ComparisonMethodMeta = {
  readonly traits: readonly CodecTrait[];
  readonly create: MethodFactory;
};

/**
 * Declares trait requirements and runtime factory for each comparison method.
 *
 * - `traits: []` means "no trait required" — always available
 * - Multi-trait: `traits: ['equality', 'order']` means BOTH traits are required
 */
export const COMPARISON_METHODS_META = {
  eq: {
    traits: ['equality'],
    create: (column) => (value: unknown) => bin('eq', column, literal(value)),
  },
  neq: {
    traits: ['equality'],
    create: (column) => (value: unknown) => bin('neq', column, literal(value)),
  },
  in: {
    traits: ['equality'],
    create: (column) => (values: readonly unknown[]) => bin('in', column, listLiteral(values)),
  },
  notIn: {
    traits: ['equality'],
    create: (column) => (values: readonly unknown[]) => bin('notIn', column, listLiteral(values)),
  },
  gt: {
    traits: ['order'],
    create: (column) => (value: unknown) => bin('gt', column, literal(value)),
  },
  lt: {
    traits: ['order'],
    create: (column) => (value: unknown) => bin('lt', column, literal(value)),
  },
  gte: {
    traits: ['order'],
    create: (column) => (value: unknown) => bin('gte', column, literal(value)),
  },
  lte: {
    traits: ['order'],
    create: (column) => (value: unknown) => bin('lte', column, literal(value)),
  },
  like: {
    traits: ['textual'],
    create: (column) => (pattern: string) => bin('like', column, literal(pattern)),
  },
  ilike: {
    traits: ['textual'],
    create: (column) => (pattern: string) => bin('ilike', column, literal(pattern)),
  },
  asc: {
    traits: ['order'],
    create: (column) => () => ({ column: column.column, direction: 'asc' as const }),
  },
  desc: {
    traits: ['order'],
    create: (column) => () => ({ column: column.column, direction: 'desc' as const }),
  },
  isNull: {
    traits: [],
    create: (column) => () => NullCheckExpr.isNull(column),
  },
  isNotNull: {
    traits: [],
    create: (column) => () => NullCheckExpr.isNotNull(column),
  },
} as const satisfies Record<keyof ComparisonMethodFns<unknown>, ComparisonMethodMeta>;

type ComparisonMethodsMeta = typeof COMPARISON_METHODS_META;

export type RelationPredicate<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = (model: ModelAccessor<TContract, ModelName>) => AnyWhereExpr;

export type RelationPredicateInput<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = RelationPredicate<TContract, ModelName> | Record<string, unknown>;

export type RelationFilterAccessor<
  TContract extends SqlContract<SqlStorage>,
  RelatedModelName extends string,
> = {
  some(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyWhereExpr;
  every(predicate: RelationPredicateInput<TContract, RelatedModelName>): AnyWhereExpr;
  none(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyWhereExpr;
};

type ScalarModelAccessor<TContract extends SqlContract<SqlStorage>, ModelName extends string> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]: ComparisonMethods<
    FieldJsType<TContract, ModelName, K>,
    FieldTraits<TContract, ModelName, K>
  >;
};

type RelationModelAccessor<TContract extends SqlContract<SqlStorage>, ModelName extends string> = {
  [K in RelationNames<TContract, ModelName>]: RelationFilterAccessor<
    TContract,
    RelatedModelName<TContract, ModelName, K> & string
  >;
};

export type ModelAccessor<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ScalarModelAccessor<TContract, ModelName> & RelationModelAccessor<TContract, ModelName>;

// ---------------------------------------------------------------------------
// DefaultModelRow — all scalar fields with JS types
// ---------------------------------------------------------------------------

export type DefaultModelRow<TContract extends SqlContract<SqlStorage>, ModelName extends string> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]: FieldJsType<TContract, ModelName, K>;
};

declare const aggregateResultBrand: unique symbol;

export interface AggregateSelector<Result> {
  readonly kind: 'aggregate';
  readonly fn: AggregateFn;
  readonly column?: string;
  readonly [aggregateResultBrand]?: Result;
}

export type AggregateSpec = Record<string, AggregateSelector<unknown>>;

export type AggregateResult<Spec extends AggregateSpec> = {
  [K in keyof Spec]: Spec[K] extends AggregateSelector<infer Result> ? Result : never;
};

export interface AggregateBuilder<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  count(): AggregateSelector<number>;
  sum<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): AggregateSelector<number | null>;
  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): AggregateSelector<number | null>;
  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): AggregateSelector<number | null>;
  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): AggregateSelector<number | null>;
}

export type HavingComparisonMethods<T> = Pick<
  ComparisonMethods<T, 'equality' | 'order'>,
  'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
>;

export interface HavingBuilder<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  count(): HavingComparisonMethods<number>;
  sum<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): HavingComparisonMethods<number | null>;
  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): HavingComparisonMethods<number | null>;
  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): HavingComparisonMethods<number | null>;
  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): HavingComparisonMethods<number | null>;
}

export type ShorthandWhereFilter<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = Partial<{
  [K in keyof DefaultModelRow<TContract, ModelName> & string]:
    | DefaultModelRow<TContract, ModelName>[K]
    | null
    | undefined;
}>;

// ---------------------------------------------------------------------------
// Helpers for extracting fields / types from the contract
// ---------------------------------------------------------------------------

type ModelsOf<TContract extends SqlContract<SqlStorage>> =
  TContract['models'] extends Record<string, unknown> ? TContract['models'] : Record<string, never>;

type ModelDef<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelName extends keyof ModelsOf<TContract> ? ModelsOf<TContract>[ModelName] : never;

type FieldsOf<TContract extends SqlContract<SqlStorage>, ModelName extends string> = ModelDef<
  TContract,
  ModelName
> extends { readonly fields: infer F }
  ? F extends Record<string, unknown>
    ? F
    : Record<string, never>
  : Record<string, never>;

type FieldValueType<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldName extends keyof FieldsOf<TContract, ModelName>
  ? FieldsOf<TContract, ModelName>[FieldName]
  : unknown;

type ModelFieldToColumnMap<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = TContract['mappings']['fieldToColumn'] extends Record<string, Record<string, string>>
  ? ModelName extends keyof TContract['mappings']['fieldToColumn']
    ? TContract['mappings']['fieldToColumn'][ModelName]
    : never
  : never;

type FieldToColumnMapSafe<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelFieldToColumnMap<TContract, ModelName> extends Record<string, string>
  ? ModelFieldToColumnMap<TContract, ModelName>
  : never;

type ModelTableFromMappings<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = TContract['mappings']['modelToTable'] extends Record<string, string>
  ? ModelName extends keyof TContract['mappings']['modelToTable']
    ? TContract['mappings']['modelToTable'][ModelName]
    : never
  : never;

type ModelTableFromModel<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelDef<TContract, ModelName> extends {
  readonly storage: { readonly table: infer T extends string };
}
  ? T
  : never;

type ModelTableName<TContract extends SqlContract<SqlStorage>, ModelName extends string> = [
  ModelTableFromMappings<TContract, ModelName>,
] extends [never]
  ? ModelTableFromModel<TContract, ModelName>
  : ModelTableFromMappings<TContract, ModelName>;

type FieldColumnName<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = (FieldToColumnMapSafe<TContract, ModelName> extends never
  ? FieldValueType<TContract, ModelName, FieldName> extends {
      readonly column: infer ColName extends string;
    }
    ? ColName
    : FieldName
  : FieldName extends keyof FieldToColumnMapSafe<TContract, ModelName>
    ? FieldToColumnMapSafe<TContract, ModelName>[FieldName]
    : FieldValueType<TContract, ModelName, FieldName> extends {
          readonly column: infer ColName extends string;
        }
      ? ColName
      : FieldName) &
  string;

type FieldStorageJsType<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? FieldColumnName<TContract, ModelName, FieldName> extends infer ColName extends string
    ? TContract['storage']['tables'] extends Record<
        string,
        { readonly columns: Record<string, unknown> }
      >
      ? TableName extends keyof TContract['storage']['tables']
        ? ColName extends keyof TContract['storage']['tables'][TableName]['columns']
          ? TContract['storage']['tables'][TableName]['columns'][ColName] extends StorageColumn
            ? ComputeColumnJsType<
                TContract,
                TableName,
                ColName,
                TContract['storage']['tables'][TableName]['columns'][ColName],
                ExtractCodecTypes<TContract>
              >
            : never
          : never
        : never
      : never
    : never
  : never;

type FieldJsType<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = [FieldStorageJsType<TContract, ModelName, FieldName>] extends [never]
  ? FieldValueType<TContract, ModelName, FieldName> extends { readonly column: string }
    ? unknown
    : FieldValueType<TContract, ModelName, FieldName>
  : FieldStorageJsType<TContract, ModelName, FieldName>;

type FieldStorageColumn<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? FieldColumnName<TContract, ModelName, FieldName> extends infer ColName extends string
    ? TContract['storage']['tables'] extends Record<
        string,
        { readonly columns: Record<string, unknown> }
      >
      ? TableName extends keyof TContract['storage']['tables']
        ? ColName extends keyof TContract['storage']['tables'][TableName]['columns']
          ? TContract['storage']['tables'][TableName]['columns'][ColName] extends StorageColumn
            ? TContract['storage']['tables'][TableName]['columns'][ColName]
            : never
          : never
        : never
      : never
    : never
  : never;

// ---------------------------------------------------------------------------
// Field trait resolution from contract CodecTypes
// ---------------------------------------------------------------------------

type FieldCodecId<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldStorageColumn<TContract, ModelName, FieldName> extends {
  readonly codecId: infer Id extends string;
}
  ? Id
  : never;

type FieldTraits<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldCodecId<TContract, ModelName, FieldName> extends infer Id extends string
  ? Id extends keyof ExtractCodecTypes<TContract>
    ? ExtractCodecTypes<TContract>[Id] extends { readonly traits: infer T }
      ? T
      : never
    : never
  : never;

export type NumericFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = {
  [K in keyof DefaultModelRow<TContract, ModelName> & string]: 'numeric' extends FieldTraits<
    TContract,
    ModelName,
    K
  >
    ? K
    : never;
}[keyof DefaultModelRow<TContract, ModelName> & string];

type ExecutionDefaultEntry<TContract extends SqlContract<SqlStorage>> =
  TContract['execution'] extends {
    readonly mutations: {
      readonly defaults: infer Defaults;
    };
  }
    ? Defaults extends ReadonlyArray<unknown>
      ? Defaults[number]
      : never
    : never;

type HasExecutionCreateDefault<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = [
  Extract<
    ExecutionDefaultEntry<TContract>,
    {
      readonly ref: {
        readonly table: ModelTableName<TContract, ModelName>;
        readonly column: FieldColumnName<TContract, ModelName, FieldName>;
      };
      readonly onCreate?: unknown;
    }
  >,
] extends [never]
  ? false
  : true;

type IsOptionalCreateField<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldStorageColumn<TContract, ModelName, FieldName> extends infer Column
  ? Column extends StorageColumn
    ? Column['nullable'] extends true
      ? true
      : Column extends { readonly default: unknown }
        ? true
        : HasExecutionCreateDefault<TContract, ModelName, FieldName>
    : HasExecutionCreateDefault<TContract, ModelName, FieldName>
  : HasExecutionCreateDefault<TContract, ModelName, FieldName>;

type CreateFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = keyof DefaultModelRow<TContract, ModelName> & string;

type RequiredCreateFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = {
  [K in CreateFieldNames<TContract, ModelName>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K
  > extends true
    ? never
    : K;
}[CreateFieldNames<TContract, ModelName>];

type OptionalCreateFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = {
  [K in CreateFieldNames<TContract, ModelName>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K
  > extends true
    ? K
    : never;
}[CreateFieldNames<TContract, ModelName>];

export type CreateInput<TContract extends SqlContract<SqlStorage>, ModelName extends string> = Pick<
  DefaultModelRow<TContract, ModelName>,
  RequiredCreateFieldNames<TContract, ModelName>
> &
  Partial<
    Pick<DefaultModelRow<TContract, ModelName>, OptionalCreateFieldNames<TContract, ModelName>>
  > &
  RelationMutationFields<TContract, ModelName>;

type ModelStorageTableDef<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? TContract['storage']['tables'] extends Record<string, unknown>
    ? TableName extends keyof TContract['storage']['tables']
      ? TContract['storage']['tables'][TableName]
      : never
    : never
  : never;

type PrimaryKeyConstraintColumns<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelStorageTableDef<TContract, ModelName> extends {
  readonly primaryKey: { readonly columns: infer Columns extends readonly string[] };
}
  ? Columns
  : never;

type UniqueConstraintColumns<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelStorageTableDef<TContract, ModelName> extends {
  readonly uniques: infer Uniques;
}
  ? Uniques extends ReadonlyArray<infer Unique>
    ? Unique extends { readonly columns: infer Columns extends readonly string[] }
      ? Columns
      : never
    : never
  : never;

type FieldNameForColumn<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  ColumnName extends string,
> = {
  [K in keyof DefaultModelRow<TContract, ModelName> & string]: FieldColumnName<
    TContract,
    ModelName,
    K
  > extends ColumnName
    ? K
    : never;
}[keyof DefaultModelRow<TContract, ModelName> & string] extends infer Matched
  ? Matched extends string
    ? Matched
    : ColumnName
  : ColumnName;

type RowValueForField<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldName extends keyof DefaultModelRow<TContract, ModelName>
  ? DefaultModelRow<TContract, ModelName>[FieldName]
  : unknown;

type CriterionFromConstraintColumns<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Columns extends readonly string[],
> = string extends Columns[number]
  ? Record<string, unknown>
  : {
      [C in Columns[number] as FieldNameForColumn<TContract, ModelName, C>]: RowValueForField<
        TContract,
        ModelName,
        FieldNameForColumn<TContract, ModelName, C>
      >;
    };

type ConstraintColumnsUnion<TContract extends SqlContract<SqlStorage>, ModelName extends string> =
  | PrimaryKeyConstraintColumns<TContract, ModelName>
  | UniqueConstraintColumns<TContract, ModelName>;

export type UniqueConstraintCriterion<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ConstraintColumnsUnion<TContract, ModelName> extends infer Columns
  ? Columns extends readonly string[]
    ? CriterionFromConstraintColumns<TContract, ModelName, Columns>
    : never
  : never;

type RelationConnectCriterion<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = [UniqueConstraintCriterion<TContract, ModelName>] extends [never]
  ? Record<string, unknown>
  : UniqueConstraintCriterion<TContract, ModelName>;

export interface RelationMutationCreate<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'create';
  readonly data: readonly MutationCreateInput<TContract, ModelName>[];
}

export interface RelationMutationConnect<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'connect';
  readonly criteria: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export interface RelationMutationDisconnect<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'disconnect';
  readonly criteria?: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export type RelationMutation<TContract extends SqlContract<SqlStorage>, ModelName extends string> =
  | RelationMutationCreate<TContract, ModelName>
  | RelationMutationConnect<TContract, ModelName>
  | RelationMutationDisconnect<TContract, ModelName>;

export interface RelationMutator<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> {
  create(
    data: MutationCreateInput<TContract, ModelName>,
  ): RelationMutationCreate<TContract, ModelName>;
  create(
    data: readonly MutationCreateInput<TContract, ModelName>[],
  ): RelationMutationCreate<TContract, ModelName>;
  connect(
    criterion: RelationConnectCriterion<TContract, ModelName>,
  ): RelationMutationConnect<TContract, ModelName>;
  connect(
    criteria: readonly RelationConnectCriterion<TContract, ModelName>[],
  ): RelationMutationConnect<TContract, ModelName>;
  disconnect(): RelationMutationDisconnect<TContract, ModelName>;
  disconnect(
    criteria: readonly RelationConnectCriterion<TContract, ModelName>[],
  ): RelationMutationDisconnect<TContract, ModelName>;
}

type RelationMutationCallback<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends RelationNames<TContract, ModelName>,
> = (
  mutator: RelationMutator<TContract, RelatedModelName<TContract, ModelName, RelName> & string>,
) => RelationMutation<TContract, RelatedModelName<TContract, ModelName, RelName> & string>;

type RelationMutationFields<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = Partial<{
  [K in RelationNames<TContract, ModelName>]: RelationMutationCallback<TContract, ModelName, K>;
}>;

type RelationDefWithChildColumns = {
  readonly to: string;
  readonly on: {
    readonly childCols: readonly string[];
  };
};

type ContractRelationEntries<TContract extends SqlContract<SqlStorage>> =
  ContractRelations<TContract>[keyof ContractRelations<TContract>] extends infer TableRelations
    ? TableRelations extends Record<string, infer Relation>
      ? Relation
      : never
    : never;

type ChildRelationColumnsForModel<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = Extract<ContractRelationEntries<TContract>, RelationDefWithChildColumns> extends infer Relation
  ? Relation extends {
      readonly to: ModelName;
      readonly on: {
        readonly childCols: infer Columns extends readonly string[];
      };
    }
    ? Columns[number]
    : never
  : never;

type ChildForeignKeyFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = FieldNameForColumn<
  TContract,
  ModelName,
  ChildRelationColumnsForModel<TContract, ModelName> & string
>;

type NestedOptionalCreateFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> =
  | OptionalCreateFieldNames<TContract, ModelName>
  | Extract<
      ChildForeignKeyFieldNames<TContract, ModelName>,
      CreateFieldNames<TContract, ModelName>
    >;

type NestedRequiredCreateFieldNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = Exclude<
  CreateFieldNames<TContract, ModelName>,
  NestedOptionalCreateFieldNames<TContract, ModelName>
>;

type NestedCreateInput<TContract extends SqlContract<SqlStorage>, ModelName extends string> = Pick<
  DefaultModelRow<TContract, ModelName>,
  NestedRequiredCreateFieldNames<TContract, ModelName>
> &
  Partial<
    Pick<
      DefaultModelRow<TContract, ModelName>,
      NestedOptionalCreateFieldNames<TContract, ModelName>
    >
  >;

type AtLeastOne<T> = keyof T extends never
  ? never
  : {
      [K in keyof T]-?: Pick<T, K> & Partial<Omit<T, K>>;
    }[keyof T];

export type MutationCreateInput<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = NestedCreateInput<TContract, ModelName> & RelationMutationFields<TContract, ModelName>;

export type MutationCreateInputWithRelations<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = NestedCreateInput<TContract, ModelName> &
  AtLeastOne<RelationMutationFields<TContract, ModelName>>;

export type MutationUpdateInput<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = Partial<DefaultModelRow<TContract, ModelName>> & RelationMutationFields<TContract, ModelName>;

// ---------------------------------------------------------------------------
// Relation helpers
// ---------------------------------------------------------------------------

type ContractRelations<TContract extends SqlContract<SqlStorage>> =
  TContract['relations'] extends Record<string, unknown>
    ? TContract['relations']
    : Record<string, never>;

type TableRelations<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? TableName extends keyof ContractRelations<TContract>
    ? ContractRelations<TContract>[TableName]
    : Record<string, never>
  : Record<string, never>;

type ExactRecord<T> =
  T extends Record<string, unknown>
    ? string extends keyof T
      ? Record<string, never>
      : T
    : Record<string, never>;

export type RelationsOf<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ExactRecord<TableRelations<TContract, ModelName>>;

export type RelationNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = (string extends keyof RelationsOf<TContract, ModelName>
  ? never
  : keyof RelationsOf<TContract, ModelName>) &
  string;

type RelationModelName<Relation> = Relation extends { readonly to: infer To extends string }
  ? To
  : Relation extends { readonly model: infer Model extends string }
    ? Model
    : never;

export type RelatedModelName<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = RelationsOf<TContract, ModelName> extends infer Rels
  ? Rels extends Record<string, unknown>
    ? RelName extends keyof Rels
      ? RelationModelName<Rels[RelName]>
      : never
    : never
  : never;

type RelationCardinalityFromRelation<Relation> = Relation extends {
  readonly cardinality: infer Cardinality extends RelationCardinalityTag;
}
  ? Cardinality
  : '1:N';

export type RelationCardinality<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = RelationsOf<TContract, ModelName> extends infer Rels
  ? Rels extends Record<string, unknown>
    ? RelName extends keyof Rels
      ? RelationCardinalityFromRelation<Rels[RelName]>
      : '1:N'
    : '1:N'
  : '1:N';

export type IncludeRelationValue<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  IncludedRow,
> = RelationCardinality<TContract, ModelName, RelName> extends '1:1' | 'N:1'
  ? IncludedRow | null
  : IncludedRow[];

export type CollectionModelName<TContract extends SqlContract<SqlStorage>> =
  keyof ModelsOf<TContract> & string;
