import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type {
  Adapter,
  BinaryBuilder,
  BuildOptions,
  ColumnBuilder,
  InferNestedProjectionRow,
  LoweredStatement,
  OrderBuilder,
  Plan,
  SelectAst,
} from './types';

export interface OrmBuilderOptions<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, TContract, LoweredStatement>;
  readonly codecTypes?: CodecTypes;
}

type ModelName<TContract extends SqlContract<SqlStorage>> = keyof TContract['models'] & string;

export type OrmRegistry<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly [K in ModelName<TContract>]: () => OrmModelBuilder<TContract, CodecTypes, K>;
};

// Relation filter builder - filter-only scope (no ordering/limit/select)
export interface OrmRelationFilterBuilder<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
> {
  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => BinaryBuilder,
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
  fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
) => OrmModelBuilder<TContract, CodecTypes, ModelName, Row>) & {
  related: TContract['relations'][ModelName] extends Record<string, { to: infer To }>
    ? To extends string
      ? {
          readonly [K in keyof TContract['relations'][ModelName]]: TContract['relations'][ModelName][K] extends {
            to: infer ChildModelName;
          }
            ? ChildModelName extends string
              ? OrmRelationAccessor<TContract, CodecTypes, ModelName, ChildModelName, Row>
              : never
            : never;
        }
      : never
    : never;
};

export interface OrmModelBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Row = unknown,
> {
  where: OrmWhereProperty<TContract, CodecTypes, ModelName, Row>;
  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => OrderBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  skip(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  select<
    Projection extends Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >,
  >(
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
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    options?: BuildOptions,
  ): Plan<Row>;
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
