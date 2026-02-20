import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type {
  ExtractCodecTypes,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';

// ---------------------------------------------------------------------------
// Comparison / Filter / Order / Include
// ---------------------------------------------------------------------------

export interface OrderExpr {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export type OrderByDirective = OrderExpr;

export interface IncludeExpr {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly fkColumn: string;
  readonly parentPkColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly nested: CollectionState;
}

// ---------------------------------------------------------------------------
// CollectionState — plain data, no query builder types
// ---------------------------------------------------------------------------

export interface CollectionState {
  readonly filters: readonly WhereExpr[];
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
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
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
  readonly contract: TContract;
  readonly runtime: RuntimeQueryable;
}

// ---------------------------------------------------------------------------
// ModelAccessor — type-safe proxy for where() callbacks
// ---------------------------------------------------------------------------

export type ComparisonMethods<T> = {
  eq(value: T): WhereExpr;
  neq(value: T): WhereExpr;
  gt(value: T): WhereExpr;
  lt(value: T): WhereExpr;
  gte(value: T): WhereExpr;
  lte(value: T): WhereExpr;
  like(pattern: string): WhereExpr;
  ilike(pattern: string): WhereExpr;
  in(values: readonly T[]): WhereExpr;
  notIn(values: readonly T[]): WhereExpr;
  isNull(): WhereExpr;
  isNotNull(): WhereExpr;
  asc(): OrderByDirective;
  desc(): OrderByDirective;
};

export type RelationPredicate<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = (model: ModelAccessor<TContract, ModelName>) => WhereExpr;

export type RelationPredicateInput<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = RelationPredicate<TContract, ModelName> | Record<string, unknown>;

export type RelationFilterAccessor<
  TContract extends SqlContract<SqlStorage>,
  RelatedModelName extends string,
> = {
  some(predicate?: RelationPredicateInput<TContract, RelatedModelName>): WhereExpr;
  every(predicate: RelationPredicateInput<TContract, RelatedModelName>): WhereExpr;
  none(predicate?: RelationPredicateInput<TContract, RelatedModelName>): WhereExpr;
};

type ScalarModelAccessor<TContract extends SqlContract<SqlStorage>, ModelName extends string> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]: ComparisonMethods<
    FieldJsType<TContract, ModelName, K>
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
  >;

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

type LegacyModelRelations<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelDef<TContract, ModelName> extends { readonly relations: infer R }
  ? R
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
> = keyof ExactRecord<TableRelations<TContract, ModelName>> extends never
  ? ExactRecord<LegacyModelRelations<TContract, ModelName>>
  : ExactRecord<TableRelations<TContract, ModelName>>;

export type RelationNames<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = keyof RelationsOf<TContract, ModelName> & string;

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
