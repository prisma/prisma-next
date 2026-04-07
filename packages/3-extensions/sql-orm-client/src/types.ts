import type { Contract, ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type {
  ExtractCodecTypes,
  ExtractQueryOperationTypes,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  type CodecTrait,
  ListExpression,
  NullCheckExpr,
  OrderByItem,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';
import type { RowSelection } from './collection-internal-types';

// ---------------------------------------------------------------------------
// Comparison / Filter / Order / Include
// ---------------------------------------------------------------------------

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
  readonly targetColumn: string;
  readonly localColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly nested: CollectionState;
  readonly scalar: IncludeScalar<unknown> | undefined;
  readonly combine: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

// ---------------------------------------------------------------------------
// CollectionState — plain data, no query builder types
// ---------------------------------------------------------------------------

export interface CollectionState {
  readonly filters: readonly AnyExpression[];
  readonly includes: readonly IncludeExpr[];
  readonly orderBy: readonly OrderByItem[] | undefined;
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

export interface CollectionContext<TContract extends Contract<SqlStorage>> {
  readonly runtime: RuntimeQueryable;
  readonly context: ExecutionContext<TContract>;
}

// ---------------------------------------------------------------------------
// ModelAccessor — type-safe proxy for where() callbacks
// ---------------------------------------------------------------------------

export type ComparisonMethodFns<T> = {
  eq(value: T): AnyExpression;
  neq(value: T): AnyExpression;
  gt(value: T): AnyExpression;
  lt(value: T): AnyExpression;
  gte(value: T): AnyExpression;
  lte(value: T): AnyExpression;
  like(pattern: string): AnyExpression;
  ilike(pattern: string): AnyExpression;
  in(values: readonly T[]): AnyExpression;
  notIn(values: readonly T[]): AnyExpression;
  isNull(): AnyExpression;
  isNotNull(): AnyExpression;
  asc(): OrderByItem;
  desc(): OrderByItem;
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
// Extension operation result — returned by calling an extension method
// ---------------------------------------------------------------------------

type QueryOperationReturnTraits<
  Returns,
  TCodecTypes extends Record<string, unknown>,
> = Returns extends { readonly codecId: infer Id extends string }
  ? Id extends keyof TCodecTypes
    ? TCodecTypes[Id] extends { readonly traits: infer Traits }
      ? Traits
      : never
    : never
  : never;

type QueryOperationReturnJsType<
  Returns,
  TCodecTypes extends Record<string, unknown>,
> = Returns extends { readonly codecId: infer Id extends string; readonly nullable: infer N }
  ? Id extends keyof TCodecTypes
    ? TCodecTypes[Id] extends { readonly output: infer O }
      ? N extends true
        ? O | null
        : O
      : unknown
    : unknown
  : unknown;

type CodecArgJsType<Arg, TCodecTypes extends Record<string, unknown>> = Arg extends {
  readonly codecId: infer CId extends string;
  readonly nullable: infer N;
}
  ? CId extends keyof TCodecTypes
    ? TCodecTypes[CId] extends { readonly output: infer O }
      ? N extends true
        ? O | null
        : O
      : unknown
    : unknown
  : unknown;

type MapArgsToJsTypes<
  Args extends readonly unknown[],
  TCodecTypes extends Record<string, unknown>,
> = Args extends readonly [infer Head, ...infer Tail]
  ? [CodecArgJsType<Head, TCodecTypes>, ...MapArgsToJsTypes<Tail, TCodecTypes>]
  : [];

type QueryOperationMethod<Op, TCodecTypes extends Record<string, unknown>> = Op extends {
  readonly args: readonly [unknown, ...infer UserArgs];
  readonly returns: infer Returns;
}
  ? (
      ...args: MapArgsToJsTypes<UserArgs, TCodecTypes>
    ) => ComparisonMethods<
      QueryOperationReturnJsType<Returns, TCodecTypes>,
      QueryOperationReturnTraits<Returns, TCodecTypes>
    >
  : never;

type FieldOperations<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldCodecId<TContract, ModelName, FieldName> extends infer CodecId extends string
  ? ExtractQueryOperationTypes<TContract> extends infer AllOps
    ? {
        [OpName in keyof AllOps & string as AllOps[OpName] extends {
          readonly args: readonly [{ readonly codecId: CodecId }, ...(readonly unknown[])];
        }
          ? OpName
          : never]: QueryOperationMethod<AllOps[OpName], ExtractCodecTypes<TContract>>;
      }
    : unknown
  : unknown;

// ---------------------------------------------------------------------------
// COMPARISON_METHODS_META — single source of truth for traits + factories
// ---------------------------------------------------------------------------

function param(codecId: string | undefined, value: unknown): ParamRef {
  return codecId ? ParamRef.of(value, { codecId }) : ParamRef.of(value);
}

function paramList(codecId: string | undefined, values: readonly unknown[]): ListExpression {
  return ListExpression.of(values.map((value) => param(codecId, value)));
}

// never[] is intentional: factories have heterogeneous signatures (value: unknown,
// values: readonly unknown[], pattern: string, etc.) but are only called through
// the typed ComparisonMethodFns interface, never through this type directly.
type MethodFactory = (
  left: AnyExpression,
  codecId: string | undefined,
) => (...args: never[]) => unknown;

type ComparisonMethodMeta = {
  readonly traits: readonly CodecTrait[];
  readonly create: MethodFactory;
};

function scalarComparisonMethod(op: BinaryOp) {
  return ((left, codecId) => (value: unknown) =>
    new BinaryExpr(op, left, param(codecId, value))) satisfies MethodFactory;
}

function listComparisonMethod(op: BinaryOp) {
  return ((left, codecId) => (values: readonly unknown[]) =>
    new BinaryExpr(op, left, paramList(codecId, values))) satisfies MethodFactory;
}

/**
 * Declares trait requirements and runtime factory for each comparison method.
 *
 * - `traits: []` means "no trait required" — always available
 * - Multi-trait: `traits: ['equality', 'order']` means BOTH traits are required
 */
export const COMPARISON_METHODS_META = {
  eq: {
    traits: ['equality'],
    create: scalarComparisonMethod('eq'),
  },
  neq: {
    traits: ['equality'],
    create: scalarComparisonMethod('neq'),
  },
  in: {
    traits: ['equality'],
    create: listComparisonMethod('in'),
  },
  notIn: {
    traits: ['equality'],
    create: listComparisonMethod('notIn'),
  },
  gt: {
    traits: ['order'],
    create: scalarComparisonMethod('gt'),
  },
  lt: {
    traits: ['order'],
    create: scalarComparisonMethod('lt'),
  },
  gte: {
    traits: ['order'],
    create: scalarComparisonMethod('gte'),
  },
  lte: {
    traits: ['order'],
    create: scalarComparisonMethod('lte'),
  },
  like: {
    traits: ['textual'],
    create: scalarComparisonMethod('like'),
  },
  ilike: {
    traits: ['textual'],
    create: scalarComparisonMethod('ilike'),
  },
  asc: {
    traits: ['order'],
    create: (left) => () => OrderByItem.asc(left),
  },
  desc: {
    traits: ['order'],
    create: (left) => () => OrderByItem.desc(left),
  },
  isNull: {
    traits: [],
    create: (left) => () => NullCheckExpr.isNull(left),
  },
  isNotNull: {
    traits: [],
    create: (left) => () => NullCheckExpr.isNotNull(left),
  },
} as const satisfies Record<keyof ComparisonMethodFns<unknown>, ComparisonMethodMeta>;

type ComparisonMethodsMeta = typeof COMPARISON_METHODS_META;

export type RelationPredicate<TContract extends Contract<SqlStorage>, ModelName extends string> = (
  model: ModelAccessor<TContract, ModelName>,
) => AnyExpression;

export type RelationPredicateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = RelationPredicate<TContract, ModelName> | Record<string, unknown>;

export type RelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  RelatedModelName extends string,
> = {
  some(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
  every(predicate: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
  none(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
};

type ScalarModelAccessor<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]: ComparisonMethods<
    FieldJsType<TContract, ModelName, K>,
    FieldTraits<TContract, ModelName, K>
  > &
    FieldOperations<TContract, ModelName, K>;
};

type RelationModelAccessor<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in RelationNames<TContract, ModelName>]: RelationFilterAccessor<
    TContract,
    RelatedModelName<TContract, ModelName, K> & string
  >;
};

export type ModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ScalarModelAccessor<TContract, ModelName> & RelationModelAccessor<TContract, ModelName>;

// ---------------------------------------------------------------------------
// DefaultModelRow — all scalar fields with JS types
// ---------------------------------------------------------------------------

export type DefaultModelRow<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]: FieldJsType<TContract, ModelName, K>;
};

// ---------------------------------------------------------------------------
// InferRootRow — discriminated union for polymorphic base models
// ---------------------------------------------------------------------------

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type VariantRow<TContract extends Contract<SqlStorage>, ModelName extends string> = ModelDef<
  TContract,
  ModelName
> extends {
  readonly discriminator: { readonly field: infer DiscField extends string };
  readonly variants: infer V;
}
  ? V extends Record<string, { readonly value: string }>
    ? {
        [VK in keyof V]: VK extends string & keyof ModelsOf<TContract>
          ? Simplify<
              Omit<DefaultModelRow<TContract, ModelName>, DiscField> &
                DefaultModelRow<TContract, VK> &
                Record<DiscField, V[VK]['value']>
            >
          : never;
      }[keyof V]
    : DefaultModelRow<TContract, ModelName>
  : DefaultModelRow<TContract, ModelName>;

export type InferRootRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = VariantRow<TContract, ModelName>;

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
  TContract extends Contract<SqlStorage>,
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

export interface HavingBuilder<TContract extends Contract<SqlStorage>, ModelName extends string> {
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
  TContract extends Contract<SqlStorage>,
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

type ModelsOf<TContract extends Contract<SqlStorage>> =
  TContract['models'] extends Record<string, unknown> ? TContract['models'] : Record<string, never>;

type ModelDef<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelName extends keyof ModelsOf<TContract> ? ModelsOf<TContract>[ModelName] : never;

type FieldsOf<TContract extends Contract<SqlStorage>, ModelName extends string> = ModelDef<
  TContract,
  ModelName
> extends { readonly fields: infer F }
  ? F extends Record<string, unknown>
    ? F
    : Record<string, never>
  : Record<string, never>;

type ModelStorageFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelDef<TContract, ModelName> extends {
  readonly storage: { readonly fields: infer Fields };
}
  ? Fields extends Record<string, { readonly column: string }>
    ? Fields
    : never
  : never;

type ModelFieldToColumnMap<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelStorageFields<TContract, ModelName> extends infer Fields
  ? Fields extends Record<string, { readonly column: string }>
    ? { readonly [F in keyof Fields]: Fields[F]['column'] }
    : never
  : never;

type FieldToColumnMapSafe<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelFieldToColumnMap<TContract, ModelName> extends Record<string, string>
  ? ModelFieldToColumnMap<TContract, ModelName>
  : never;

type ModelTableName<TContract extends Contract<SqlStorage>, ModelName extends string> = ModelDef<
  TContract,
  ModelName
> extends {
  readonly storage: { readonly table: infer T extends string };
}
  ? T
  : never;

type FieldColumnName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = (FieldToColumnMapSafe<TContract, ModelName> extends never
  ? FieldName
  : FieldName extends keyof FieldToColumnMapSafe<TContract, ModelName>
    ? FieldToColumnMapSafe<TContract, ModelName>[FieldName]
    : FieldName) &
  string;

type ResolvedStorageColumn<
  TContract extends Contract<SqlStorage>,
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

type FieldStorageJsType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = ResolvedStorageColumn<TContract, ModelName, FieldName> extends infer Col extends StorageColumn
  ? ComputeColumnJsType<
      TContract,
      ModelTableName<TContract, ModelName> & string,
      FieldColumnName<TContract, ModelName, FieldName> & string,
      Col,
      ExtractCodecTypes<TContract>
    >
  : never;

type FieldJsType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = [FieldStorageJsType<TContract, ModelName, FieldName>] extends [never]
  ? unknown
  : FieldStorageJsType<TContract, ModelName, FieldName>;

type FieldStorageColumn<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = ResolvedStorageColumn<TContract, ModelName, FieldName>;

// ---------------------------------------------------------------------------
// Field trait resolution from contract CodecTypes
// ---------------------------------------------------------------------------

type FieldCodecId<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldStorageColumn<TContract, ModelName, FieldName> extends {
  readonly codecId: infer Id extends string;
}
  ? Id
  : never;

type FieldTraits<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldCodecId<TContract, ModelName, FieldName> extends infer Id extends string
  ? Id extends keyof ExtractCodecTypes<TContract>
    ? ExtractCodecTypes<TContract>[Id] extends { readonly traits: infer T }
      ? T
      : never
    : never
  : never;

export type NumericFieldNames<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in keyof DefaultModelRow<TContract, ModelName> & string]: 'numeric' extends FieldTraits<
    TContract,
    ModelName,
    K
  >
    ? K
    : never;
}[keyof DefaultModelRow<TContract, ModelName> & string];

type ExecutionDefaultEntry<TContract extends Contract<SqlStorage>> =
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
  TContract extends Contract<SqlStorage>,
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
  TContract extends Contract<SqlStorage>,
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = keyof DefaultModelRow<TContract, ModelName> & string;

type RequiredCreateFieldNames<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in CreateFieldNames<TContract, ModelName>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K
  > extends true
    ? never
    : K;
}[CreateFieldNames<TContract, ModelName>];

type OptionalCreateFieldNames<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in CreateFieldNames<TContract, ModelName>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K
  > extends true
    ? K
    : never;
}[CreateFieldNames<TContract, ModelName>];

export type CreateInput<TContract extends Contract<SqlStorage>, ModelName extends string> = Pick<
  DefaultModelRow<TContract, ModelName>,
  RequiredCreateFieldNames<TContract, ModelName>
> &
  Partial<
    Pick<DefaultModelRow<TContract, ModelName>, OptionalCreateFieldNames<TContract, ModelName>>
  > &
  RelationMutationFields<TContract, ModelName>;

type ModelStorageTableDef<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? TContract['storage']['tables'] extends Record<string, unknown>
    ? TableName extends keyof TContract['storage']['tables']
      ? TContract['storage']['tables'][TableName]
      : never
    : never
  : never;

type PrimaryKeyConstraintColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ModelStorageTableDef<TContract, ModelName> extends {
  readonly primaryKey: { readonly columns: infer Columns extends readonly string[] };
}
  ? Columns
  : never;

type UniqueConstraintColumns<
  TContract extends Contract<SqlStorage>,
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
  TContract extends Contract<SqlStorage>,
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldName extends keyof DefaultModelRow<TContract, ModelName>
  ? DefaultModelRow<TContract, ModelName>[FieldName]
  : unknown;

type CriterionFromConstraintColumns<
  TContract extends Contract<SqlStorage>,
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

type ConstraintColumnsUnion<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | PrimaryKeyConstraintColumns<TContract, ModelName>
  | UniqueConstraintColumns<TContract, ModelName>;

export type UniqueConstraintCriterion<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ConstraintColumnsUnion<TContract, ModelName> extends infer Columns
  ? Columns extends readonly string[]
    ? CriterionFromConstraintColumns<TContract, ModelName, Columns>
    : never
  : never;

type RelationConnectCriterion<TContract extends Contract<SqlStorage>, ModelName extends string> = [
  UniqueConstraintCriterion<TContract, ModelName>,
] extends [never]
  ? Record<string, unknown>
  : UniqueConstraintCriterion<TContract, ModelName>;

export interface RelationMutationCreate<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'create';
  readonly data: readonly MutationCreateInput<TContract, ModelName>[];
}

export interface RelationMutationConnect<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'connect';
  readonly criteria: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export interface RelationMutationDisconnect<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'disconnect';
  readonly criteria?: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export type RelationMutation<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | RelationMutationCreate<TContract, ModelName>
  | RelationMutationConnect<TContract, ModelName>
  | RelationMutationDisconnect<TContract, ModelName>;

export interface RelationMutator<TContract extends Contract<SqlStorage>, ModelName extends string> {
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends RelationNames<TContract, ModelName>,
> = (
  mutator: RelationMutator<TContract, RelatedModelName<TContract, ModelName, RelName> & string>,
) => RelationMutation<TContract, RelatedModelName<TContract, ModelName, RelName> & string>;

type RelationMutationFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = Partial<{
  [K in RelationNames<TContract, ModelName>]: RelationMutationCallback<TContract, ModelName, K>;
}>;

type AllModelRelationEntries<TContract extends Contract<SqlStorage>> = {
  [M in keyof ModelsOf<TContract>]: ModelsOf<TContract>[M] extends {
    readonly relations: infer R extends Record<string, unknown>;
  }
    ? R[keyof R]
    : never;
}[keyof ModelsOf<TContract>];

type RelationDefWithTargetFields = {
  readonly to: string;
  readonly on: {
    readonly targetFields: readonly string[];
  };
};

type ChildForeignKeyFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = Extract<AllModelRelationEntries<TContract>, RelationDefWithTargetFields> extends infer Relation
  ? Relation extends {
      readonly to: ModelName;
      readonly on: {
        readonly targetFields: infer Fields extends readonly string[];
      };
    }
    ? Fields[number]
    : never
  : never;

type NestedOptionalCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> =
  | OptionalCreateFieldNames<TContract, ModelName>
  | Extract<
      ChildForeignKeyFieldNames<TContract, ModelName>,
      CreateFieldNames<TContract, ModelName>
    >;

type NestedRequiredCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = Exclude<
  CreateFieldNames<TContract, ModelName>,
  NestedOptionalCreateFieldNames<TContract, ModelName>
>;

type NestedCreateInput<TContract extends Contract<SqlStorage>, ModelName extends string> = Pick<
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = NestedCreateInput<TContract, ModelName> & RelationMutationFields<TContract, ModelName>;

export type MutationCreateInputWithRelations<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = NestedCreateInput<TContract, ModelName> &
  AtLeastOne<RelationMutationFields<TContract, ModelName>>;

export type MutationUpdateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = Partial<DefaultModelRow<TContract, ModelName>> & RelationMutationFields<TContract, ModelName>;

// ---------------------------------------------------------------------------
// Relation helpers
// ---------------------------------------------------------------------------

type ModelRelations<TContract extends Contract<SqlStorage>, ModelName extends string> = ModelDef<
  TContract,
  ModelName
> extends { readonly relations: infer R }
  ? R extends Record<string, unknown>
    ? R
    : Record<string, never>
  : Record<string, never>;

type ExactRecord<T> =
  T extends Record<string, unknown>
    ? string extends keyof T
      ? Record<string, never>
      : T
    : Record<string, never>;

export type RelationsOf<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = ExactRecord<ModelRelations<TContract, ModelName>>;

export type RelationNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = (string extends keyof RelationsOf<TContract, ModelName>
  ? never
  : keyof RelationsOf<TContract, ModelName>) &
  string;

type RelationModelName<Relation> = Relation extends { readonly to: infer To extends string }
  ? To
  : never;

export type RelatedModelName<
  TContract extends Contract<SqlStorage>,
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = RelationsOf<TContract, ModelName> extends infer Rels
  ? Rels extends Record<string, unknown>
    ? RelName extends keyof Rels
      ? RelationCardinalityFromRelation<Rels[RelName]>
      : '1:N'
    : '1:N'
  : '1:N';

type RelationLocalFieldColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Relation,
> = Relation extends {
  readonly on: { readonly localFields: infer Fields extends readonly string[] };
}
  ? MapFieldsToColumns<TContract, ModelName, Fields>
  : readonly [];

type MapFieldsToColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Fields extends readonly string[],
> = Fields extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? readonly [
      FieldColumnName<TContract, ModelName, Head>,
      ...MapFieldsToColumns<TContract, ModelName, Tail>,
    ]
  : readonly [];

type AnyColumnNullable<
  Columns extends Record<string, StorageColumn>,
  ColNames extends readonly string[],
> = ColNames extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? Head extends keyof Columns
    ? Columns[Head]['nullable'] extends true
      ? true
      : AnyColumnNullable<Columns, Tail>
    : true
  : false;

type HasForeignKeyForCols<
  FKs extends readonly unknown[],
  Cols extends readonly string[],
> = FKs extends readonly [infer Head, ...infer Tail extends unknown[]]
  ? Head extends { readonly columns: Cols }
    ? true
    : HasForeignKeyForCols<Tail, Cols>
  : false;

type IsFkSideOfRelation<
  Table extends StorageTable,
  ParentCols extends readonly string[],
> = Table extends { readonly foreignKeys: infer FKs extends readonly unknown[] }
  ? HasForeignKeyForCols<FKs, ParentCols>
  : false;

type IsToOneRelationNullable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = ModelTableName<TContract, ModelName> extends infer TableName extends string
  ? TableName extends keyof TContract['storage']['tables']
    ? TContract['storage']['tables'][TableName] extends infer Table extends StorageTable
      ? RelationsOf<TContract, ModelName> extends infer Rels extends Record<string, unknown>
        ? RelName extends keyof Rels
          ? RelationLocalFieldColumns<
              TContract,
              ModelName,
              Rels[RelName]
            > extends infer Cols extends readonly string[]
            ? IsFkSideOfRelation<Table, Cols> extends true
              ? AnyColumnNullable<Table['columns'], Cols>
              : true
            : true
          : true
        : true
      : true
    : true
  : true;

export type IncludeRelationValue<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  IncludedRow,
> = RelationCardinality<TContract, ModelName, RelName> extends '1:1' | 'N:1'
  ? IsToOneRelationNullable<TContract, ModelName, RelName> extends true
    ? IncludedRow | null
    : IncludedRow
  : IncludedRow[];

export type CollectionModelName<TContract extends Contract<SqlStorage>> =
  keyof ModelsOf<TContract> & string;
