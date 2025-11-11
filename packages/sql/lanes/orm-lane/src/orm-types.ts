import type { Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  BuildOptions,
  ColumnBuilder,
  InferNestedProjectionRow,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import type { OrmIncludeChildBuilder } from './orm-include-child';

export interface OrmBuilderOptions<TContract extends SqlContract<SqlStorage>> {
  readonly context: RuntimeContext<TContract>;
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
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => AnyBinaryBuilder,
  ): OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>;
}

// Relation accessor - exposes relations with some/none/every methods
export type OrmRelationAccessor<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
  ChildModelName extends string,
  Row,
> = {
  some(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  none(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  every(
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
};

// Where property - both a function and an object with related
export type OrmWhereProperty<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
  Row,
> = ((
  fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
) => OrmModelBuilder<TContract, CodecTypes, ModelName, Row>) & {
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
              ? OrmRelationAccessor<TContract, CodecTypes, ModelName, ChildModelName, Row>
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
            ? (
                child: (
                  child: OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName>,
                ) => OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, unknown>,
              ) => OrmModelBuilder<TContract, CodecTypes, ModelName, Row>
            : never
          : never;
      }
    : Record<string, never>
  : Record<string, never>;

export interface OrmModelBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Row = unknown,
> {
  where: OrmWhereProperty<TContract, CodecTypes, ModelName, Row>;
  include: OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row>;
  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyOrderBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  skip(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  select<Projection extends Record<string, AnyColumnBuilder | boolean | NestedProjection>>(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => Projection,
  ): OrmModelBuilder<
    TContract,
    CodecTypes,
    ModelName,
    InferNestedProjectionRow<Projection, CodecTypes>
  >;
  findMany(options?: BuildOptions): Plan<Row>;
  findFirst(options?: BuildOptions): Plan<Row>;
  findUnique(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    options?: BuildOptions,
  ): Plan<Row>;
  create(data: Record<string, unknown>, options?: BuildOptions): Plan<number>;
  update(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    data: Record<string, unknown>,
    options?: BuildOptions,
  ): Plan<number>;
  delete(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    options?: BuildOptions,
  ): Plan<number>;
}

export type ModelColumnAccessor<
  TContract extends SqlContract<SqlStorage>,
  _CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
> = TContract['models'][ModelName] extends { fields: infer Fields }
  ? Fields extends Record<string, unknown>
    ? {
        readonly [K in keyof Fields]: ColumnBuilder<
          K & string,
          TContract['storage']['tables'][TContract['mappings']['modelToTable'] extends Record<
            string,
            string
          >
            ? TContract['mappings']['modelToTable'][ModelName]
            : never]['columns'][K & string],
          unknown
        >;
      }
    : never
  : never;
