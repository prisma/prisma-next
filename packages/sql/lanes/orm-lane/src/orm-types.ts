import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type {
  AnyColumnBuilder,
  AnyOrderBuilder,
  AnyPredicateBuilder,
  BuildOptions,
  ColumnBuilder,
  ComputeColumnJsType,
  InferNestedProjectionRow,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';
import type { OrmIncludeChildBuilder } from './orm-include-child';

export interface OrmBuilderOptions<TContract extends SqlContract<SqlStorage>> {
  readonly context: QueryLaneContext<TContract>;
}

type ModelName<TContract extends SqlContract<SqlStorage>> = keyof TContract['models'] & string;

type LowercaseModelName<M extends string> = M extends `${infer First}${infer Rest}`
  ? `${Lowercase<First>}${Rest}`
  : M;

// Helper to get table name from model name
type ModelToTableName<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = TContract['mappings']['modelToTable'] extends Record<string, string>
  ? TContract['mappings']['modelToTable'][ModelName] extends string
    ? TContract['mappings']['modelToTable'][ModelName]
    : never
  : never;

// Helper to get relations for a model (via table name)
type ModelRelations<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = ModelToTableName<TContract, ModelName> extends string
  ? TContract['relations'][ModelToTableName<TContract, ModelName>] extends Record<
      string,
      { to: string }
    >
    ? TContract['relations'][ModelToTableName<TContract, ModelName>]
    : Record<string, never>
  : Record<string, never>;

type ModelFieldToColumnMap<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = TContract['mappings']['fieldToColumn'] extends Record<string, Record<string, string>>
  ? ModelName extends keyof TContract['mappings']['fieldToColumn']
    ? TContract['mappings']['fieldToColumn'][ModelName]
    : never
  : never;

type FieldColumnName<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = ModelFieldToColumnMap<TContract, ModelName> extends Record<string, string>
  ? FieldName extends keyof ModelFieldToColumnMap<TContract, ModelName>
    ? ModelFieldToColumnMap<TContract, ModelName>[FieldName]
    : FieldName
  : FieldName;

type ModelColumnMeta<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  ColumnName extends string,
> = ModelToTableName<TContract, ModelName> extends infer TableName extends string
  ? TableName extends keyof TContract['storage']['tables']
    ? ColumnName extends keyof TContract['storage']['tables'][TableName]['columns']
      ? TContract['storage']['tables'][TableName]['columns'][ColumnName]
      : never
    : never
  : never;

type _IndexKeys = string | number | symbol;

export type IncludeAccumulator<
  Includes extends Record<string, unknown>,
  Key extends string,
  Value,
> = {
  readonly [K in Exclude<keyof Includes, _IndexKeys> | Key]: K extends Key ? Value : Includes[K];
};

export type OrmRegistry<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly [K in ModelName<TContract>]: () => OrmModelBuilder<TContract, CodecTypes, K>;
} & {
  readonly [K in ModelName<TContract> as LowercaseModelName<K>]: () => OrmModelBuilder<
    TContract,
    CodecTypes,
    K
  >;
};

// Relation filter builder - filter-only scope (no ordering/limit/select)
export interface OrmRelationFilterBuilder<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
> {
  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => AnyPredicateBuilder,
  ): OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>;
}

// Relation accessor - exposes relations with some/none/every methods
export type OrmRelationAccessor<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
  ChildModelName extends string,
  Includes extends Record<string, unknown>,
  Row,
> = {
  some(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
  none(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
  every(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
};

// Where property - both a function and an object with related
export type OrmWhereProperty<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
  Includes extends Record<string, unknown>,
  Row,
> = ((
  fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyPredicateBuilder,
) => OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>) & {
  related: ModelRelations<TContract, ModelName> extends Record<string, { to: infer To }>
    ? To extends string
      ? {
          readonly [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
            TContract,
            ModelName
          >[K] extends {
            to: infer ChildModelName;
          }
            ? ChildModelName extends string
              ? OrmRelationAccessor<TContract, CodecTypes, ModelName, ChildModelName, Includes, Row>
              : never
            : never;
        }
      : Record<string, never>
    : Record<string, never>;
};

// Include accessor - exposes relations with include methods
export type OrmIncludeAccessor<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
  Includes extends Record<string, unknown>,
  Row,
> = ModelRelations<TContract, ModelName> extends Record<string, { to: infer To }>
  ? To extends string
    ? {
        readonly [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
          TContract,
          ModelName
        >[K] extends {
          to: infer ChildModelName;
        }
          ? ChildModelName extends string
            ? <ChildRow>(
                child: (
                  child: OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName>,
                ) => OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow>,
              ) => OrmModelBuilder<
                TContract,
                CodecTypes,
                ModelName,
                IncludeAccumulator<Includes, K & string, ChildRow>,
                Row
              >
            : never
          : never;
      }
    : Record<string, never>
  : Record<string, never>;

export interface OrmModelBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Includes extends Record<string, unknown> = Record<string, never>,
  Row = unknown,
> {
  where: OrmWhereProperty<TContract, CodecTypes, ModelName, Includes, Row>;
  include: OrmIncludeAccessor<TContract, CodecTypes, ModelName, Includes, Row>;
  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyOrderBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
  skip(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
  select<Projection extends Record<string, AnyColumnBuilder | boolean | NestedProjection>>(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => Projection,
  ): OrmModelBuilder<
    TContract,
    CodecTypes,
    ModelName,
    Includes,
    InferNestedProjectionRow<Projection, CodecTypes, Includes>
  >;
  findMany(options?: BuildOptions): SqlQueryPlan<Row>;
  findFirst(options?: BuildOptions): SqlQueryPlan<Row>;
  findUnique(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyPredicateBuilder,
    options?: BuildOptions,
  ): SqlQueryPlan<Row>;
  create(data: Record<string, unknown>, options?: BuildOptions): SqlQueryPlan<number>;
  update(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyPredicateBuilder,
    data: Record<string, unknown>,
    options?: BuildOptions,
  ): SqlQueryPlan<number>;
  delete(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyPredicateBuilder,
    options?: BuildOptions,
  ): SqlQueryPlan<number>;
}

export type ModelColumnAccessor<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
> = TContract['models'][ModelName] extends { fields: infer Fields }
  ? Fields extends Record<string, unknown>
    ? {
        readonly [K in keyof Fields & string]: ColumnBuilder<
          K,
          ModelColumnMeta<TContract, ModelName, FieldColumnName<TContract, ModelName, K>>,
          ComputeColumnJsType<
            TContract,
            ModelToTableName<TContract, ModelName>,
            FieldColumnName<TContract, ModelName, K>,
            ModelColumnMeta<TContract, ModelName, FieldColumnName<TContract, ModelName, K>>,
            CodecTypes
          >
        >;
      }
    : never
  : never;
